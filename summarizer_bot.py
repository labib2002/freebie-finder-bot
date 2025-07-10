import configparser
import requests
import sqlite3
import logging
import asyncio
import google.generativeai as genai
from bs4 import BeautifulSoup
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import TelegramError

# --- Configuration & Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Helper Functions ---
def load_config(path='config.ini'):
    config = configparser.ConfigParser()
    config.read(path)
    return config

def get_pending_deals(db_path):
    """Fetches all deal URLs from the database."""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT url FROM deals")
        deals = [row[0] for row in cursor.fetchall()]
        conn.close()
        return deals
    except sqlite3.OperationalError:
        logging.warning("Database or table not found. Assuming no deals yet.")
        return []

def clear_deals_db(db_path):
    """Deletes all records from the deals table."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM deals")
    conn.commit()
    conn.close()
    logging.info("Deals database has been cleared for the next cycle.")

def scrape_url_content(url):
    """Scrapes the main text content from a URL."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'lxml')
        # Get title and main text content for better context
        title = soup.title.string if soup.title else "No Title"
        return f"URL: {url}\nTITLE: {title}\nCONTENT: {' '.join(soup.body.get_text().split()[:200])}\n---\n"
    except Exception as e:
        logging.error(f"Failed to scrape {url}: {e}")
        return ""

async def get_summary_from_gemini(api_key, raw_data):
    """Sends data to Gemini and gets a formatted summary."""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-flash') # Using Flash for speed and cost-effectiveness

    prompt = f"""
    You are a helpful gaming news analyst. Your task is to analyze the following raw data, which contains links and scraped text from recent free game announcements, and generate a clean, concise summary in Telegram-compatible MarkdownV2 format.

    Your summary should have the following structure:
    1. A main title, for example: "Daily Freebie Digest for July 10, 2025".
    2. A brief, one or two-sentence overview highlighting the most exciting deal(s) of the day.
    3. A MarkdownV2 table with three columns: "Game Title", "Platform", "Type (Game/DLC/Other), and direct link if avaiable.".
    Here is the raw data scraped from the web. Analyze it, de-duplicate it, and create the summary.

    --- RAW DATA ---
    {raw_data}
    --- END RAW DATA ---
    """

    try:
        logging.info("Sending request to Gemini API...")
        response = await model.generate_content_async(prompt)
        logging.info("Received response from Gemini API.")
        return response.text
    except Exception as e:
        logging.error(f"Error calling Gemini API: {e}")
        return "Failed to generate summary due to an API error."

async def send_telegram_message(bot_token, chat_id, message):
    """Sends the final summary message to Telegram."""
    try:
        bot = Bot(token=bot_token)
        # Send the long summary message
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2)
        logging.info("Successfully sent summary to Telegram.")
    except TelegramError as e:
        logging.error(f"Telegram API Error: {e}")

async def main():
    logging.info("--- Summarizer Bot Run Started ---")
    config = load_config()
    db_path = config['settings']['database_file']
    
    pending_deals = get_pending_deals(db_path)
    
    if not pending_deals:
        logging.info("No new deals to summarize. Exiting.")
        return

    logging.info(f"Found {len(pending_deals)} deals to process.")
    
    # Scrape content for all deals concurrently
    scraped_data_list = [scrape_url_content(url) for url in pending_deals]
    raw_data_for_prompt = "".join(scraped_data_list)
    
    if not raw_data_for_prompt.strip():
        logging.warning("Scraping resulted in no data. Cannot generate summary.")
        return

    # Get the summary from Gemini
    gemini_api_key = config['gemini']['api_key']
    summary_message = await get_summary_from_gemini(gemini_api_key, raw_data_for_prompt)
    
    # Send the summary to Telegram
    telegram_token = config['telegram']['token']
    chat_id = config['telegram']['chat_id']
    await send_telegram_message(telegram_token, chat_id, summary_message)
    
    # Clear the database for the next run
    clear_deals_db(db_path)
    
    logging.info("--- Summarizer Bot Run Finished ---")

if __name__ == "__main__":
    asyncio.run(main())