const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {path: '/admin/socket.io'});
require('dotenv').config()
const {ironSession} = require("iron-session/express");
const mongoose = require("mongoose");
const bodyParser = require('body-parser');
const expressRobotsTxt = require('express-robots-txt');
const path = require('path');
const User = require("./models/user");
const Order = require("./models/order");
const Product = require("./models/product");

const { Liquid } = require('liquidjs');

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(expressRobotsTxt({UserAgent: '*', Disallow: '/'}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true}));
app.use('/admin', express.static(path.join(__dirname, 'public')))

const liquidEngine = new Liquid({
  root: ['views/', 'views/pages/', 'views/snippets/'],
  extname: '.liquid',
  jsTruthy: true,
  cache: process.env.NODE_ENV === 'production'
});
app.engine('liquid', liquidEngine.express());
app.set('views', './views');
app.set('view engine', 'liquid');

main().catch(err => console.log(err));
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
}

const session = ironSession({
    password: process.env.SESSION_OPTION_PASSWORD,
    cookieName: process.env.SESSION_OPTION_COOKIE_NAME,
    ttl: 0,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
    },
});

const {getFullDate} = require('./utils/date');

app.get("/admin/orders", session, async function (req, res, next) {
    try {
      if (!req.session.user) {
          throw("Auth error")
      }

      const status = req.query.status;

      const user = await User.findById(req.session.user.id);
      if (!user) {
          throw("user not found");
      }
      if (!user.isAdmin) {
          throw("user does not have permissions");
      }

      let filter = {$and: [{financialStatus: {$ne: 'paid'}}, {fulfillmentStatus: {$ne: 'fulfilled'}}]};
      if (status === 'completed') {
        filter = {$and: [{financialStatus: 'paid'}, {fulfillmentStatus: 'fulfilled'}]};
      }

      const orders = [];
      const ordersFromDB = await Order.find(filter, null, {skip: 0, limit: 35}).sort({_id: -1});
      for (let order of ordersFromDB) {
          const date = getFullDate(order.createdAt);

          const productIds = order.lineItems.map(i => i.productId);
          const products = await Product.find({'_id': {$in: productIds}});
          const lineItems = order.lineItems.map(item => {
            const product = products.find(p => p.id === String(item.productId));
            const images = product.images.map(img => ({
              src: img.src,
              srcWebp: img.srcWebp,
              width: img.width,
              height: img.height,
              alt: img.alt
            }));

            return {
              id: item.id,
              title: item.title,
              brand: item.brand,
              price: item.price,
              grams: item.grams,
              quantity: item.quantity,
              displayAmount: item.displayAmount,
              unit: item.unit,
              productId: item.productId,
              image: images.length ? images[0] : null,
              images
            };
          });

          const user = await User.findById(order.userId);
          if (!user) {
            continue;
          }
          const customer = {
            id: user.id,
            phone: user.phone,
            locale: user.locale
          };

          let discount = null;
          if (order.discount) {
            discount = {
              code: order.discount.code
            };
          }

          orders.push({
            id: order.id,
            orderNumber: order.orderNumber,
            date,
            financialStatus: order.financialStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            totalShippingPrice: order.totalShippingPrice,
            totalTax: order.totalTax,
            totalLineItemsPrice: order.totalLineItemsPrice, 
            totalDiscounts: order.totalDiscounts,
            subtotalPrice: order.subtotalPrice,
            totalPrice: order.totalPrice,
            totalWeight: order.totalWeight,
            discount,
            lineItems,
            shippingAddress: {
              address1: order.shippingAddress.address1
            },
            customer
          });
      }

      const count = await Order.countDocuments(filter);

      const content_for_layout = await liquidEngine.renderFile('orders', {orders, count, status});
      res.render('layout', {content_for_layout});
    } catch(e) {
        next(e);
    }
});

app.post("/admin/api/alert/new_order", async function (req, res, next) {
    try {
        if (!req.body.id) {
            throw('ID require');
        }

        const {id} = req.body;

        const order = await Order.findById(id);
        if (!order) {
            throw('Order not found');
        }

        const date = getFullDate(order.createdAt);
    
        const productIds = order.lineItems.map(i => i.productId);
        const products = await Product.find({'_id': {$in: productIds}});
        const lineItems = order.lineItems.map(item => {
          const product = products.find(p => p.id === String(item.productId));
          const images = product.images.map(img => ({
            src: img.src,
            srcWebp: img.srcWebp,
            width: img.width,
            height: img.height,
            alt: img.alt
          }));

          return {
            id: item.id,
            title: item.title,
            brand: item.brand,
            price: item.price,
            grams: item.grams,
            quantity: item.quantity,
            displayAmount: item.displayAmount,
            unit: item.unit,
            productId: item.productId,
            image: images.length ? images[0] : null,
            images
          };
        });

        const user = await User.findById(order.userId);
        const customer = {
          id: user.id,
          phone: user.phone,
          locale: user.locale
        };

        let discount = null;
        if (order.discount) {
          discount = {
            code: order.discount.code
          };
        }

        const output = {
          id: order.id,
          orderNumber: order.orderNumber,
          date,
          financialStatus: order.financialStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          totalShippingPrice: order.totalShippingPrice,
          totalTax: order.totalTax,
          totalLineItemsPrice: order.totalLineItemsPrice, 
          totalDiscounts: order.totalDiscounts,
          subtotalPrice: order.subtotalPrice,
          totalPrice: order.totalPrice,
          totalWeight: order.totalWeight,
          discount,
          lineItems,
          shippingAddress: {
            address1: order.shippingAddress.address1
          },
          customer
        };

        const item = await liquidEngine.renderFile('order-card-list', {order: output});

        io.emit('orders', item);

        res.json({});
    } catch(e) {
        next(e);
    }
});

app.post("/admin/api/complete_order", async function (req, res, next) {
  const orderId = req.body.orderId;

  try {
    await Order.findByIdAndUpdate(orderId, {financialStatus: 'paid', fulfillmentStatus: 'fulfilled', updatedAt: new Date()});

    res.redirect('/admin/orders');
  } catch (e) {
    next(e);
  }
});

app.use((req, res, next) => {
    const err = new Error('Страница не найдена');
    err.status = 404;
    next(err);
});
app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.send(err.message || 'Internal Server Error');
});

app.set('port', process.env.PORT);

server.listen(app.get('port'));