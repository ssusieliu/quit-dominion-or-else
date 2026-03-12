// netlify/functions/add_contact.js
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

async function addPhoneToGitHub(encryptedPhone, name) {
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
  
  if (getResponse.ok) {
    const fileData = await getResponse.json();
    sha = fileData.sha;
    const content = Buffer.from(fileData.content, 'base64').toString('utf8');
    currentData = JSON.parse(content);
  }
  
  // Add new encrypted phone
  currentData.push({
    encrypted: encryptedPhone,
    name: name,
    added: new Date().toISOString()
  });
  
  // Update file on GitHub
  const newContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');
  
  const updateUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/phone_numbers.json`;
  
  const updateResponse = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add phone number for ${name}`,
      content: newContent,
      sha: sha
    })
  });
  
  if (!updateResponse.ok) {
    const error = await updateResponse.text();
    throw new Error(`GitHub update failed: ${error}`);
  }
  
  return true;
}

async function sendConfirmationSMS(phoneNumber, name) {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
  
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('Twilio not configured, skipping SMS');
    return false;
  }
  
  const message = `Hi ${name}! Welcome to the Quit Dominion or Else community!`;
  
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
    
    // Add to GitHub
    await addPhoneToGitHub(encryptedPhone, name);
    console.log('Added to GitHub');
    
    // Send confirmation SMS
    const smsSent = await sendConfirmationSMS(phoneNumber, name);
    console.log('SMS sent:', smsSent);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: 'Successfully added to alert list!',
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