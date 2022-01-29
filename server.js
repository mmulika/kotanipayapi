const dotenv = require('dotenv');

  

dotenv.config();

  

console.log(`Your App Name is ${process.env.APP_NAME}`);

console.log(`Your App Environment is ${process.env.APP_ENV}`);

console.log(`Your App Port is ${process.env.APP_PORT}`);