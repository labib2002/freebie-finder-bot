import configparser
import requests
import feedparser
import time
import logging
import sqlite3
import re  # Import the regular expressions module
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import TelegramError

# --- Configuration & Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Helper Functions ---
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

# --- NEW & IMPROVED SANITIZER FUNCTION ---
def sanitize_markdown(text):
    """
    Escapes characters that are special to Telegram's MarkdownV2 parser.
    """
    # Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    # Use a regular expression to find and escape them
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

async def send_telegram_message(bot_token, chat_id, message):
    try:
        bot = Bot(token=bot_token)
        # We now use MarkdownV2 which is more strict but more powerful
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2, disable_web_page_preview=True)
        logging.info(f"Successfully sent notification for: {message.splitlines()[0]}")
    except TelegramError as e:
        logging.error(f"Telegram API Error: {e} | Message: {message}")
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
            # Use the new sanitizer on the title
            sanitized_title = sanitize_markdown(entry.title)
            sanitized_url = sanitize_markdown(deal_url)
            
            # Format the message for MarkdownV2
            message = f"*{title_prefix}:*\n\n*_{sanitized_title}_*\n\n[Link to Deal]({deal_url})"
            
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
    # This function remains largely the same but we'll sanitize its output too
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
                title = sanitize_markdown(deal['title'])
                platforms = sanitize_markdown(deal['platforms'])
                
                message = f"*New Deal from GamerPower:*\n\n*_{title}_*\nPlatforms: `{platforms}`\n\n[Link to Deal]({deal_url})"
                
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
    logging.info("--- Freebie-Finder Bot v2.2 Run Started ---") # Maybe update version number
    config = configparser.ConfigParser()
    config.read('config.ini')
    db_path = config['settings']['database_file']
    
    setup_database(db_path)
    
    await check_generic_rss(db_path, config, "Reddit", config['sources']['reddit_rss_url'], "New Deal from Reddit")
    await check_generic_rss(db_path, config, "SteamDB", config['sources']['steamdb_rss_url'], "New FREE Steam Game")
    await check_generic_rss(db_path, config, "Prime Gaming", config['sources']['primegaming_rss_url'], "New Prime Gaming Drop")
    await check_generic_rss(db_path, config, "IsThereAnyDeal", config['sources']['isthereanydeal_rss_url'], "New Deal from ITAD")
    await check_gamerpower_api(db_path, config)
    
    logging.info("--- Freebie-Finder Bot v2.2 Run Finished ---")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())