# Copy and paste the full bot_v2.py script from our previous conversation here.
# (The one that uses sqlite3 and checks all the RSS/API sources)
import configparser
import requests
import feedparser
import time
import logging
import sqlite3
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import TelegramError

# --- Configuration & Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Database Setup & Helpers ---
def setup_database(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS deals (
            url TEXT PRIMARY KEY
        )
    ''')
    conn.commit()
    conn.close()
    logging.info(f"Database '{db_path}' is set up.")

def is_deal_seen(db_path, url):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT url FROM deals WHERE url = ?", (url,))
    result = cursor.fetchone()
    conn.close()
    return result is not None

def save_seen_deal(db_path, url):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO deals (url) VALUES (?)", (url,))
        conn.commit()
    except sqlite3.IntegrityError:
        logging.warning(f"URL '{url}' already exists in DB. Skipping.")
    finally:
        conn.close()

# --- Telegram Notification ---
async def send_telegram_message(bot_token, chat_id, message):
    try:
        bot = Bot(token=bot_token)
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)
        logging.info(f"Successfully sent notification for: {message.splitlines()[0]}")
    except TelegramError as e:
        logging.error(f"Telegram API Error: {e}")
    except Exception as e:
        logging.error(f"An unexpected error occurred while sending Telegram message: {e}")

# --- Data Source Checkers ---
async def check_generic_rss(db_path, config, source_name, url, title_prefix):
    logging.info(f"Checking {source_name} RSS feed...")
    feed = feedparser.parse(url)
    
    new_deals_found = 0
    for entry in reversed(feed.entries):
        deal_url = entry.link
        if not is_deal_seen(db_path, deal_url):
            title = entry.title.replace('[', '`[').replace(']', ']`')
            message = f"*{title_prefix}:*\n\n**{title}**\n\n{deal_url}"
            
            await send_telegram_message(
                config['telegram']['token'], 
                config['telegram']['chat_id'], 
                message
            )
            
            save_seen_deal(db_path, deal_url)
            new_deals_found += 1
            time.sleep(1)

    logging.info(f"{source_name} Check Complete. Found {new_deals_found} new deals.")

async def check_gamerpower_api(db_path, config):
    logging.info("Checking GamerPower API...")
    url = config['sources']['gamerpower_api_url']
    
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        deals = response.json()
    except requests.RequestException as e:
        logging.error(f"Could not fetch data from GamerPower API: {e}")
        return

    new_deals_found = 0
    for deal in reversed(deals):
        if deal.get('type') == 'Game':
            deal_url = deal.get('open_giveaway_url')
            if deal_url and not is_deal_seen(db_path, deal_url):
                title = deal['title']
                platforms = deal['platforms']
                message = f"*New Deal from GamerPower:*\n\n**{title}**\n*({platforms})*\n\n{deal_url}"
                
                await send_telegram_message(
                    config['telegram']['token'], 
                    config['telegram']['chat_id'], 
                    message
                )
                
                save_seen_deal(db_path, deal_url)
                new_deals_found += 1
                time.sleep(1)

    logging.info(f"GamerPower API Check Complete. Found {new_deals_found} new deals.")

# --- Main Execution Block ---
async def main():
    logging.info("--- Freebie-Finder Bot v2.0 Run Started ---")
    config = configparser.ConfigParser()
    config.read('config.ini')
    db_path = config['settings']['database_file']
    
    setup_database(db_path)
    
    await check_generic_rss(db_path, config, "Reddit", config['sources']['reddit_rss_url'], "New Deal from Reddit")
    await check_generic_rss(db_path, config, "SteamDB", config['sources']['steamdb_rss_url'], "New FREE Steam Game")
    await check_generic_rss(db_path, config, "Prime Gaming", config['sources']['primegaming_rss_url'], "New Prime Gaming Drop")
    await check_gamerpower_api(db_path, config)
    
    logging.info("--- Freebie-Finder Bot v2.0 Run Finished ---")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())