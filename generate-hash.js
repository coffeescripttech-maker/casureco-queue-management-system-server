/**
 * Generate bcrypt hash for a password
 * Run: node generate-hash.js
 */

const bcrypt = require('bcryptjs');

const password = 'admin123';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  console.log('\n🔑 Password:', password);
  console.log('🔐 Hash:', hash);
  console.log('\n📋 SQL Query to update user:');
  console.log(`
UPDATE users 
SET password_hash = '${hash}' 
WHERE email = 'admin@test.com';
  `);
  
  // Test the hash
  bcrypt.compare(password, hash, (err, result) => {
    console.log('\n✅ Hash verification test:', result);
  });
});
