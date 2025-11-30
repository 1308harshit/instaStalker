// Script to update frontend API URL for ngrok
// Usage: node update-frontend-api.js <ngrok-url>
// Example: node update-frontend-api.js https://abc123.ngrok.io

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ngrokUrl = process.argv[2];

if (!ngrokUrl) {
  console.error('❌ Please provide ngrok URL');
  console.log('Usage: node update-frontend-api.js <ngrok-url>');
  console.log('Example: node update-frontend-api.js https://abc123.ngrok.io');
  process.exit(1);
}

// Remove trailing slash if present
const cleanUrl = ngrokUrl.replace(/\/$/, '');
const apiUrl = `${cleanUrl}/api/stalkers`;

// Create .env.local file for frontend
const envContent = `VITE_API_URL=${apiUrl}
VITE_SNAPSHOT_BASE=${cleanUrl}
`;

const envPath = path.join(__dirname, 'frontend', '.env.local');

fs.writeFileSync(envPath, envContent, 'utf8');

console.log('✅ Frontend API URL updated!');
console.log(`📝 Created: frontend/.env.local`);
console.log(`🔗 API URL: ${apiUrl}`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Rebuild frontend: cd frontend && npm run build`);
console.log(`   2. Or use dev mode: cd frontend && npm run dev`);
console.log(`   3. Access from any device using the ngrok URL!`);

