// // r2.js
// const AWS = require('aws-sdk');

// const allowed = new Set(['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc', 'auto']);
// let region = (process.env.R2_REGION || 'auto').toLowerCase();
// if (!allowed.has(region)) {
//   console.warn(`R2 region "${process.env.R2_REGION}" is invalid; falling back to "auto"`);
//   region = 'auto';
// }

// const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// const s3 = new AWS.S3({
//   endpoint,
//   accessKeyId: process.env.R2_ACCESS_KEY_ID,
//   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
//   signatureVersion: 'v4',
//   region
//   // s3ForcePathStyle: true, // optional if you need it
// });

// module.exports = s3;
