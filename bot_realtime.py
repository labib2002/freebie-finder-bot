import configparser
import requests
import feedparser
import time
import logging
import sqlite3
import re
import os
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import TelegramError

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Helper Functions (Copied from Summarizer) ---
def sanitize_markdown_v2(text: str) -> str:
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

def sanitize_url(url: str) -> str:
    """Escapes only the parentheses '()' inside a URL for MarkdownV2 links."""
    return url.replace('(', '\\(').replace(')', '\\)')

# --- Database & Logging Functions ---
def setup_database(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS deals (url TEXT PRIMARY KEY)')
    conn.commit()
    conn.close()
    logging.info(f"Permanent database '{db_path}' is ready.")

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
        logging.warning(f"URL '{url}' already in permanent DB. Skipping save.")
    finally:
        conn.close()

def log_deal_for_summary(url, title, filename="daily_deals.txt"):
    try:
        with open(filename, 'a', encoding='utf-8') as f:
            f.write(f"{url}|||{title}\n")
        logging.info(f"Logged deal for daily summary: {title}")
    except Exception as e:
        logging.error(f"Failed to log deal for summary: {e}")

async def send_telegram_message(bot_token, chat_id, message):
    try:
        bot = Bot(token=bot_token)
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2, disable_web_page_preview=True)
        logging.info(f"Successfully sent notification for: {message.splitlines()[0]}")
    except TelegramError as e:
        logging.error(f"FATAL Telegram API Error: {e}")
        logging.error(f"Message Content that failed:\n---\n{message}\n---")


async def check_generic_rss(db_path, bot_token, chat_id, source_name, url, title_prefix):
    logging.info(f"Checking {source_name} RSS feed...")
    feed = feedparser.parse(url)
    new_deals_found = 0
    for entry in reversed(feed.entries):
        deal_url = entry.link
        if not is_deal_seen(db_path, deal_url):
            sanitized_title = sanitize_markdown_v2(entry.title)
            # --- FIX APPLIED HERE ---
            sanitized_link_url = sanitize_url(deal_url)
            message = f"*{sanitize_markdown_v2(title_prefix)}:*\n\n*_{sanitized_title}_*\n\n[Link to Deal]({sanitized_link_url})"
            await send_telegram_message(bot_token, chat_id, message)
            save_seen_deal(db_path, deal_url)
            log_deal_for_summary(deal_url, entry.title)
            new_deals_found += 1
    logging.info(f"{source_name} Check Complete. Found {new_deals_found} new deals.")

async def check_gamerpower_api(db_path, bot_token, chat_id, url):
    logging.info("Checking GamerPower API...")
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
                title = sanitize_markdown_v2(deal['title'])
                platforms = sanitize_markdown_v2(deal['platforms'])
                # --- FIX APPLIED HERE ---
                sanitized_link_url = sanitize_url(deal_url)
                message = f"*New Deal from GamerPower:*\n\n*_{title}_*\nPlatforms: `{platforms}`\n\n[Link to Deal]({sanitized_link_url})"
                await send_telegram_message(bot_token, chat_id, message)
                save_seen_deal(db_path, deal_url)
                log_deal_for_summary(deal_url, deal['title'])
                new_deals_found += 1
    logging.info(f"GamerPower API Check Complete. Found {new_deals_found} new deals.")

async def main():
    logging.info("--- Real-Time Notifier Bot v4.0 (URL Sanitizing) Run Started ---")
    is_github_action = os.getenv('GITHUB_ACTIONS') == 'true'
    if is_github_action:
        telegram_token = os.getenv('TELEGRAM_TOKEN')
        chat_id = os.getenv('TELEGRAM_CHAT_ID')
        sources = {
            'reddit_rss_url': 'https://www.reddit.com/r/FreeGameFindings/new.rss',
            'steamdb_rss_url': 'https://steamdb.info/upcoming/free/rss/',
            'primegaming_rss_url': 'https://primegaming.blog/feed',
            'isthereanydeal_rss_url': 'https://isthereanydeal.com/rss/free/',
            'gamerpower_api_url': 'https://www.gamerpower.com/api/giveaways'
        }
        db_path = 'freebies.db'
    else:
        config = configparser.ConfigParser()
        config.read('config.ini')
        telegram_token = config['telegram']['token']
        chat_id = config['telegram']['chat_id']
        sources = config['sources']
        db_path = config['settings']['database_file']

    if not telegram_token or not chat_id:
        logging.error("Telegram credentials missing. Aborting.")
        return

    setup_database(db_path)

    await check_generic_rss(db_path, telegram_token, chat_id, "Reddit", sources['reddit_rss_url'], "New Deal from Reddit")
    await check_generic_rss(db_path, telegram_token, chat_id, "SteamDB", sources['steamdb_rss_url'], "New FREE Steam Game")
    await check_generic_rss(db_path, telegram_token, chat_id, "Prime Gaming", sources['primegaming_rss_url'], "New Prime Gaming Drop")
    await check_generic_rss(db_path, telegram_token, chat_id, "IsThereAnyDeal", sources['isthereanydeal_rss_url'], "New Deal from ITAD")
    await check_gamerpower_api(db_path, telegram_token, chat_id, sources['gamerpower_api_url'])

    logging.info("--- Real-Time Notifier Bot Run Finished ---")

if __name__ == "__main__":
    asyncio.run(main())