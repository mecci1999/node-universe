import { Star } from '../../dist/index.esm'

const star = new Star({
  namespace: 'gateway-demo',
  transporter: {
    type: 'KAFKA',
    debug: true,
    host: 'localhost:9092'
  }
});

