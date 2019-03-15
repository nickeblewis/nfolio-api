import Mailchimp from 'mailchimp-api-v3';
import nodemailer from 'nodemailer';
import Stripe from 'stripe';
import async from 'async';
import { first } from 'underscore';

import { getEntry, getEntries, createEntry } from './contentful';

import conf from './config';

const transporter = nodemailer.createTransport({
  service: 'Mailgun',
  auth: {
    user: conf.get('mailer.user'),
    pass: conf.get('mailer.password'),
  },
});

export default {
  Query: {
    hello: () => 'Hello world!',
  },
  Mutation: {
    createOrder: async (parent, args) => {
      // get products
      const totalCost = await new Promise(resolve => {
        let total = 0;
        async.each(
          args.productIds,
          async (productId, callback) => {
            const product = await getEntry(productId);
            total += product.discountPrice;
            callback();
          },
          () => {
            resolve(total);
          },
        );
      });

      // process payment with stripe
      const stripe = new Stripe(conf.get('stripeKey'));
      try {
        const charge = await stripe.charges.create({
          amount: `${totalCost}00`,
          currency: 'gbp',
          description: `Order by ${args.customerEmail} for something new`,
          source: args.tokenId,
          receipt_email: args.customerEmail,
        });
        //console.log('charge', charge);
        args.stripeId = charge.id;
        args.status = charge.status;
        args.total = totalCost.toString();
      } catch (error) {
        console.error('payment error', error);
        throw new Error('Payment failed.');
      }

      // add to db
      // send array of products
      if (args.productIds) {
        args.product = args.productIds.map(item => ({
          sys: {
            type: 'Link',
            linkType: 'Entry',
            id: item,
          },
        }));
      }

      delete args.tokenId;
      delete args.productIds;
      const order = await createEntry(args, 'order');//const order = await createEntry(args, 'order');cconst order = await createEntry(args, 'order');onst order = await createEntry(args, 'order');
      return order;
    },
    validateCoupon: async (parent, args) => {
      const coupons = await getEntries('coupons', { 'fields.code': args.code });
      const coupon = first(coupons);
      if (!coupon) {
        throw new Error('Invalid coupon.');
      }
      return coupon;
    },
    subscribe: async (parent, args) => {
      const mailchimp = new Mailchimp(conf.get('mailchimp.key'));
      const list = conf.get('mailchimp.list');
      await mailchimp.post(`/lists/${list}/members`, {
        email_address: args.email,
        status: 'subscribed',
      });

      return args;
    },
    contact: async (parent, args) => {
      const { name, email, message } = args;

      const mailOptions = {
        to: conf.get('adminEmail'),
        from: `${name} <${email}>`,
        subject: `${conf.get('siteName')} Contact Form`,
        text: message,
      };

      try {
        await transporter.sendMail(mailOptions);
        return {
          status: 'success',
          message: 'Contact informaton sent successfully',
        };
      } catch (err) {
        return { status: 'error', message: err.message };
      }
    },
  },
};
