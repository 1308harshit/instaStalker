// Quick script to check if the frontend is accessible and capture console logs
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5173,
  path: '/',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers, null, 2)}`);
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\n=== RESPONSE BODY (first 500 chars) ===');
    console.log(data.substring(0, 500));
    console.log('\n=== CHECKING FOR SCRIPT TAGS ===');
    const scriptMatches = data.match(/<script[^>]*>/g);
    if (scriptMatches) {
      console.log('Found scripts:', scriptMatches.length);
      scriptMatches.slice(0, 3).forEach(s => console.log(s));
    }
  });
});

req.on('error', (e) => {
  console.error(`ERROR: ${e.message}`);
});

req.end();
