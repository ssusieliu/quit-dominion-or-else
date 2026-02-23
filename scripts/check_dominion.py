import os
import json
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright
import requests

DATA_DIR = Path("data")
STATS_FILE = DATA_DIR / "dominion_play_stats.json"
PHONE_NUMBERS_FILE = DATA_DIR / "contact_list.json"

def load_data():
    """Load previous stats and phone numbers"""
    DATA_DIR.mkdir(exist_ok=True)
    
    if STATS_FILE.exists():
        with open(STATS_FILE, 'r') as f:
            stats = json.load(f)
    else:
        stats = {
            "last_game_count": 0,
            "last_played_timestamp": None,
            "last_check_timestamp": None
        }
    
    if PHONE_NUMBERS_FILE.exists():
        with open(PHONE_NUMBERS_FILE, 'r') as f:
            phone_numbers = json.load(f)
    else:
        phone_numbers = []
    
    return stats, phone_numbers

def save_stats(stats):
    """Save updated stats"""
    with open(STATS_FILE, 'w') as f:
        json.dump(stats, f, indent=2)

def get_game_count():
    """Login to dominion.games and get game count from leaderboard"""
    username = os.environ.get('DOMINION_USERNAME')
    password = os.environ.get('DOMINION_PASSWORD')
    
    if not username or not password:
        print("WARNING: DOMINION_USERNAME and DOMINION_PASSWORD not set")
        return None
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        try:
            # Navigate to login page
            print("Navigating to dominion.games...")
            page.goto('https://dominion.games/', timeout=30000)
            
            # Fill in credentials
            print("Logging in...")
            page.fill('input[name="username"]', username)
            page.fill('input[name="password"]', password)
            page.wait_for_load_state('networkidle', timeout=30000)
            page.click('input[type="submit"].login-button', force=True)
            
            # Wait for login to complete
            page.wait_for_load_state('networkidle', timeout=30000)
            
            # Navigate to leaderboard
            print("Clicking Leaderboard tab...")
            page.wait_for_selector('button.tab-button:has-text("Leaderboard")', timeout=10000)
            page.click('button.tab-button:has-text("Leaderboard")')
            
            # Wait for game count to load
            try:
                page.wait_for_selector('div.rating-details-value.rating-games', timeout=10000)
                
                # Wait for data to populate
                print("Waiting for data to load...")
                page.wait_for_timeout(3000)  # 3 second wait
                
                print("✅ Leaderboard data loaded!")
            except:
                print("⚠️  Could not confirm data loaded, but continuing...")
            
            # Extract game count
            print("Extracting game count...")
            
            game_count_element = page.query_selector('div.rating-details-value.rating-games')
            
            if game_count_element:
                game_count = int(game_count_element.inner_text().strip())
                print(f"Found game count: {game_count}")
                return game_count
            else:
                print("ERROR: Could not find game count element")
                # Take a screenshot for debugging
                page.screenshot(path=DATA_DIR / "debug_screenshot.png")
                return None
                
        except Exception as e:
            print(f"ERROR: {e}")
            try:
                page.screenshot(path=DATA_DIR / "error_screenshot.png")
            except:
                pass
            return None
        finally:
            browser.close()

def send_sms_alerts(phone_numbers, game_count, time_since_last):
    """Send SMS alerts via Twilio"""
    account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
    auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
    from_number = os.environ.get('TWILIO_PHONE_NUMBER')
    
    if not all([account_sid, auth_token, from_number]):
        print("WARNING: Twilio credentials not configured, skipping SMS")
        return
    
    message = f"🚨 DOMINION STREAK BROKEN! 🚨\n\nStreak duration: {time_since_last}\nTotal games: {game_count}\n\nYou are owed $10!"
    
    for phone_number in phone_numbers:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
            data = {
                'From': from_number,
                'To': phone_number,
                'Body': message
            }
            response = requests.post(url, data=data, auth=(account_sid, auth_token))
            
            if response.status_code == 201:
                print(f"SMS sent to {phone_number}")
            else:
                print(f"Failed to send SMS to {phone_number}: {response.text}")
        except Exception as e:
            print(f"Error sending SMS to {phone_number}: {e}")

def format_time_duration(seconds):
    """Format seconds into a readable duration"""
    if seconds < 60:
        return f"{seconds} seconds"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    elif seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        days = seconds // 86400
        return f"{days} day{'s' if days != 1 else ''}"

def main():
    print(f"Running check at {datetime.now(timezone.utc).isoformat()}")
    
    # Load previous data
    stats, phone_numbers = load_data()
    
    # Get current game count
    current_game_count = get_game_count()
    
    if current_game_count is None:
        print("Failed to get game count, skipping this check")
        return
    
    current_time = datetime.now(timezone.utc).isoformat()
    previous_game_count = stats['last_game_count']
    
    print(f"Previous game count: {previous_game_count}")
    print(f"Current game count: {current_game_count}")
    
    # Check if games increased
    if current_game_count > previous_game_count:
        print("🚨 GAMES INCREASED - STREAK BROKEN!")
        
        # Calculate time since last played
        if stats['last_played_timestamp']:
            last_played = datetime.fromisoformat(stats['last_played_timestamp'])
            time_diff = datetime.now(timezone.utc) - last_played
            time_since_last = format_time_duration(int(time_diff.total_seconds()))
        else:
            time_since_last = "Unknown (first check)"
        
        # # Send alerts
        # if phone_numbers:
        #     send_sms_alerts(phone_numbers, current_game_count, time_since_last)
        # else:
        #     print("No phone numbers registered for alerts")
        
        # Update last played timestamp
        stats['last_played_timestamp'] = current_time
    else:
        print("✓ No new games played")
    
    # Update stats
    stats['last_game_count'] = current_game_count
    stats['last_check_timestamp'] = current_time
    
    # Save updated stats
    save_stats(stats)
    print("Stats saved successfully")

if __name__ == "__main__":
    main()