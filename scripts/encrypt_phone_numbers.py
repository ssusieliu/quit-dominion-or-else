# scripts/encrypt_phone.py
# Helper script to encrypt phone numbers for storage

import os
import json
from cryptography.fernet import Fernet
from pathlib import Path

DATA_DIR = Path("data")
PHONE_NUMBERS_FILE = DATA_DIR / "phone_numbers.json"

def generate_key():
    """Generate a new encryption key (run this once)"""
    key = Fernet.generate_key()
    print("\n" + "="*60)
    print("ENCRYPTION KEY GENERATED")
    print("="*60)
    print("\nAdd this to your GitHub Secrets as 'ENCRYPTION_KEY':")
    print(f"\n{key.decode()}\n")
    print("="*60)
    return key

def get_encryption_key():
    """Get encryption key from environment or generate new one"""
    key = os.environ.get('ENCRYPTION_KEY')
    if key:
        print("Using ENCRYPTION_KEY from environment variable")
        return key.encode()
    else:
        print("No ENCRYPTION_KEY found in environment")
        response = input("Generate a new key? (yes/no): ").strip().lower()
        if response == 'yes':
            return generate_key()
        else:
            print("Exiting...")
            exit(1)

def encrypt_phone_number(phone_number, key):
    """Encrypt a phone number"""
    f = Fernet(key)
    return f.encrypt(phone_number.encode()).decode()

def decrypt_phone_number(encrypted_phone, key):
    """Decrypt a phone number (for testing)"""
    f = Fernet(key)
    return f.decrypt(encrypted_phone.encode()).decode()

def add_phone_number(phone_number):
    """Add an encrypted phone number to the list"""
    key = get_encryption_key()
    
    # Validate phone number format
    if not phone_number.startswith('+'):
        print("Error: Phone number must start with + and include country code")
        print("Example: +1234567890")
        return
    
    # Load existing encrypted numbers
    DATA_DIR.mkdir(exist_ok=True)
    if PHONE_NUMBERS_FILE.exists():
        with open(PHONE_NUMBERS_FILE, 'r') as f:
            encrypted_numbers = json.load(f)
    else:
        encrypted_numbers = []
    
    # Encrypt the new number
    encrypted = encrypt_phone_number(phone_number, key)
    
    # Add to list
    encrypted_numbers.append(encrypted)
    
    # Save
    with open(PHONE_NUMBERS_FILE, 'w') as f:
        json.dump(encrypted_numbers, f, indent=2)
    
    print(f"\n✅ Successfully added encrypted phone number!")
    print(f"   Original: {phone_number}")
    print(f"   Encrypted: {encrypted[:50]}...")
    print(f"   Total numbers in list: {len(encrypted_numbers)}")

def list_phone_numbers():
    """List all encrypted phone numbers (decrypted if key available)"""
    if not PHONE_NUMBERS_FILE.exists():
        print("No phone numbers file found.")
        return
    
    with open(PHONE_NUMBERS_FILE, 'r') as f:
        encrypted_numbers = json.load(f)
    
    if not encrypted_numbers:
        print("No phone numbers in list.")
        return
    
    print(f"\nFound {len(encrypted_numbers)} phone number(s):")
    print("-" * 60)
    
    try:
        key = get_encryption_key()
        for i, encrypted in enumerate(encrypted_numbers, 1):
            try:
                decrypted = decrypt_phone_number(encrypted, key)
                print(f"{i}. {decrypted}")
            except Exception as e:
                print(f"{i}. [Error decrypting: {str(e)}]")
    except:
        # No key available, just show encrypted versions
        for i, encrypted in enumerate(encrypted_numbers, 1):
            print(f"{i}. {encrypted[:50]}...")

def main():
    print("\n" + "="*60)
    print("PHONE NUMBER ENCRYPTION HELPER")
    print("="*60)
    print("\nOptions:")
    print("1. Generate new encryption key")
    print("2. Add encrypted phone number")
    print("3. List phone numbers")
    print("4. Exit")
    
    choice = input("\nEnter choice (1-4): ").strip()
    
    if choice == '1':
        generate_key()
    elif choice == '2':
        phone = input("Enter phone number (with country code, e.g., +1234567890): ").strip()
        add_phone_number(phone)
    elif choice == '3':
        list_phone_numbers()
    elif choice == '4':
        print("Exiting...")
    else:
        print("Invalid choice")

if __name__ == "__main__":
    main()