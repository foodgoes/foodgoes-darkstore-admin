const socket = io({path: '/admin/socket.io'});

const ttlOrders = document.querySelector('.ttlOrders');
const orders = document.querySelector('.orders');
const statusAttr = orders.dataset.status;

socket.on('orders', function(order) {
    if (!statusAttr) {
        orders.insertAdjacentHTML('afterbegin', order);
        ttlOrders.textContent = +ttlOrders.textContent + 1;
        window.scrollTo(0, 0);   
    }
});