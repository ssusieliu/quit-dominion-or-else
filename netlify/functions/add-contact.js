// netlify/functions/add-contact.js
// Backend API to encrypt and save phone numbers

const crypto = require('crypto');

// Simple Fernet-like encryption using Node's crypto
function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'base64'), iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

// Decrypt function
function decrypt(encryptedText, key) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }
    
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'base64'), iv);
    
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

async function addPhoneToGitHub(encryptedPhone, phoneNumber, name, encryptionKey) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_USER = process.env.GITHUB_USER;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  
  if (!GITHUB_TOKEN || !GITHUB_USER || !GITHUB_REPO) {
    throw new Error('GitHub configuration missing');
  }
  
  // Get current file content
  const getUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/phone_numbers.json`;
  
  const getResponse = await fetch(getUrl, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  let currentData = [];
  let sha = null;
  let isUpdate = false;
  let updatedIndex = -1;
  
  if (getResponse.ok) {
    const fileData = await getResponse.json();
    sha = fileData.sha;
    const content = Buffer.from(fileData.content, 'base64').toString('utf8');
    currentData = JSON.parse(content);
    
    // Check for duplicates by decrypting existing numbers
    console.log(`Checking ${currentData.length} existing entries for duplicates...`);
    
    for (let i = 0; i < currentData.length; i++) {
      const entry = currentData[i];
      
      // Handle both old format (just string) and new format (object)
      const encryptedValue = typeof entry === 'string' ? entry : entry.encrypted;
      
      if (encryptedValue) {
        const decryptedPhone = decrypt(encryptedValue, encryptionKey);
        
        if (decryptedPhone === phoneNumber) {
          console.log(`Found duplicate at index ${i}, updating entry...`);
          isUpdate = true;
          updatedIndex = i;
          
          // Update the existing entry
          currentData[i] = {
            encrypted: encryptedPhone,
            name: name,
            added: typeof entry === 'object' && entry.added ? entry.added : new Date().toISOString(),
            updated: new Date().toISOString()
          };
          break;
        }
      }
    }
  }
  
  // If not a duplicate, add new entry
  if (!isUpdate) {
    console.log('No duplicate found, adding new entry...');
    currentData.push({
      encrypted: encryptedPhone,
      name: name,
      added: new Date().toISOString()
    });
  }
  
  // Update file on GitHub
  const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
  
  const updateUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/phone_numbers.json`;
  
  const commitMessage = isUpdate 
    ? `Update phone number entry for ${name} (was duplicate)`
    : `Add phone number for ${name}`;
  
  const updateResponse = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: commitMessage,
      content: newContent,
      sha: sha
    })
  });
  
  if (!updateResponse.ok) {
    const error = await updateResponse.text();
    throw new Error(`GitHub update failed: ${error}`);
  }
  
  return { isUpdate, updatedIndex };
}

async function sendConfirmationSMS(phoneNumber, name, isUpdate) {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('Twilio not configured, skipping SMS');
    return false;
  }
  
  const message = isUpdate
    ? `Hi ${name}! Your info has been updated in the Quit Dominion Or Else database.`
    : `Hi ${name}! Welcome to the Quit Dominion Or Else community. Your help is greatly appreciated. Let's pray Susie never plays Dominion again.`;
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  
  const params = new URLSearchParams();
  params.append('From', TWILIO_PHONE_NUMBER);
  params.append('To', phoneNumber);
  params.append('Body', message);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Twilio error:', error);
    return false;
  }
  
  return true;
}

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  
  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }
  
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    // Parse request body
    const { phoneNumber, name } = JSON.parse(event.body);
    
    // Validate inputs
    if (!phoneNumber || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Phone number and name are required' })
      };
    }
    
    // Validate phone number format (E.164)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid phone number format. Use E.164 format (e.g., +1234567890)' })
      };
    }
    
    // Get encryption key
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) {
      throw new Error('Encryption key not configured');
    }
    
    // Encrypt phone number
    const encryptedPhone = encrypt(phoneNumber, ENCRYPTION_KEY);
    console.log('Phone encrypted');
    
    // Add to GitHub (checks for duplicates internally)
    const { isUpdate, updatedIndex } = await addPhoneToGitHub(encryptedPhone, phoneNumber, name, ENCRYPTION_KEY);
    console.log(isUpdate ? `Updated existing entry at index ${updatedIndex}` : 'Added new entry');
    
    // Send confirmation SMS
    const smsSent = await sendConfirmationSMS(phoneNumber, name, isUpdate);
    console.log('SMS sent:', smsSent);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: isUpdate ? 'Successfully updated your info!' : 'Successfully added to alert list!',
        isUpdate,
        smsSent
      })
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process request',
        details: error.message 
      })
    };
  }
};