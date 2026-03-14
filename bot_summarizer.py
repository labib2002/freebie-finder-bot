import configparser
import logging
import asyncio
import os
import re
import json
import google.generativeai as genai
from telegram import Bot
from telegram.constants import ParseMode
from telegram.error import TelegramError

# --- Configuration & Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Helper Functions ---
def get_pending_deals(filename="daily_deals.txt"):
    deals = []
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            for line in f:
                if '|||' in line:
                    deals.append(line.strip().split('|||', 1))
        return list(set(map(tuple, deals)))
    except FileNotFoundError:
        logging.info("No daily deals log file found. Nothing to summarize.")
        return []

def clear_daily_log(filename="daily_deals.txt"):
    try:
        if os.path.exists(filename):
            os.remove(filename)
            logging.info(f"Successfully cleared '{filename}' for the next cycle.")
    except Exception as e:
        logging.error(f"Failed to clear daily log: {e}")

def sanitize_markdown_v2(text: str) -> str:
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

def sanitize_url(url: str) -> str:
    return url.replace('(', '\\(').replace(')', '\\)')

async def get_summary_from_gemini(api_key, deals_data):
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-3.1-pro-preview')

    # Cap at 50 deals to avoid overwhelming the API
    if len(deals_data) > 50:
        logging.warning(f"Capping deals from {len(deals_data)} to 50 for summarization.")
        deals_data = deals_data[:50]

    formatted_deals = "\n".join([f"- {title} | {url}" for url, title in deals_data])
    prompt = f"""You are a gaming deals analyst. Summarize these free game deals into a daily digest.

Deals found today:
{formatted_deals}

Respond with ONLY valid JSON (no markdown fencing, no extra text). Use this exact schema:
{{
  "title": "Free Games Digest - [today's date]",
  "overview": "Brief one-sentence overview of today's deals",
  "deals": [
    {{"title": "Game Name", "platform": "Steam", "url": "https://..."}}
  ]
}}

Rules:
- Keep ALL original URLs exactly as provided, do not modify them
- Detect platform from the title brackets (e.g. [Steam], [Epic Games], [GOG])
- If platform is unclear, use "PC" as default
- Include every deal from the input list"""

    try:
        logging.info(f"Sending {len(deals_data)} deals to Gemini API...")
        response = await model.generate_content_async(prompt)
        logging.info("Received response from Gemini API.")
        return response.text or ""
    except Exception as e:
        logging.error(f"Error calling Gemini API: {e}")
        return ""

async def send_telegram_message(bot_token, chat_id, message):
    if not message:
        logging.warning("Attempted to send an empty message. Aborting.")
        return

    bot = Bot(token=bot_token)
    try:
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2)
        logging.info("Successfully sent summary to Telegram.")
    except TelegramError as e:
        logging.error(f"Telegram API Error: {e}")
        logging.error(f"Message length: {len(message)} chars")
        raise e

async def main():
    logging.info("--- Summarizer Bot v6.0 (JSON-based) Run Started ---")
    log_file = "daily_deals.txt"
    
    # --- Step 1: Load Config and Credentials ---
    is_github_action = os.getenv('GITHUB_ACTIONS') == 'true'
    if is_github_action:
        telegram_token = os.getenv('TELEGRAM_TOKEN')
        chat_id = os.getenv('TELEGRAM_CHAT_ID')
        gemini_api_key = os.getenv('GEMINI_API_KEY')
    else:
        # Code for local execution (unchanged)
        config = configparser.ConfigParser()
        config.read('config.ini')
        telegram_token = config['telegram']['token']
        chat_id = config['telegram']['chat_id']
        gemini_api_key = config['gemini']['api_key']

    if not all([telegram_token, chat_id, gemini_api_key]):
        logging.error("One or more required credentials are missing. Aborting.")
        return

    # --- Step 2: Get Pending Deals ---
    pending_deals = get_pending_deals(log_file)
    if not pending_deals:
        logging.info("No new deals to summarize. Exiting.")
        return

    # --- Try to build and send the message. Only clear the log on full success. ---
    try:
        # --- Step 3: Get Structured Data from AI ---
        raw_summary = await get_summary_from_gemini(gemini_api_key, pending_deals)
        if not raw_summary:
            raise Exception("Gemini API returned empty response.")

        # --- Step 4: Parse JSON response ---
        cleaned = raw_summary.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:])
        if cleaned.endswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[:-1])
        cleaned = cleaned.strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logging.error(f"Failed to parse Gemini JSON: {e}")
            logging.error(f"Raw response (first 500 chars): {raw_summary[:500]}")
            raise Exception("Gemini returned invalid JSON.")

        # --- Step 5: Build the Final Message ---
        title = sanitize_markdown_v2(data.get("title", "Free Games Digest"))
        overview = sanitize_markdown_v2(data.get("overview", ""))

        message_parts = [f"*{title}*"]
        if overview:
            message_parts.append(f"\n_{overview}_")

        deal_lines = []
        for deal in data.get("deals", []):
            try:
                d_title = sanitize_markdown_v2(deal["title"])
                d_platform = sanitize_markdown_v2(deal.get("platform", "Unknown"))
                d_url = sanitize_url(deal["url"])
                deal_lines.append(f"\u2022 *{d_title}* on `{d_platform}` ([Link]({d_url}))")
            except (KeyError, TypeError) as e:
                logging.warning(f"Skipping malformed deal entry: {e}")

        if not deal_lines:
            raise Exception("No deals could be parsed from Gemini response.")

        message_parts.append("\n" + "\n".join(deal_lines))
        footer = "\n\n_This summary was automatically generated by the Hoard\\-Watcher's Chronicler\\._"
        final_message = "\n".join(message_parts) + footer

        # --- Step 6: Send the Message ---
        await send_telegram_message(telegram_token, chat_id, final_message)

        # --- Step 7: Clean Up ONLY on full success ---
        clear_daily_log(log_file)

    except Exception as e:
        logging.error(f"Summarization failed: {e}")
        logging.error("daily_deals.txt preserved for next run.")

    logging.info("--- Summarizer Bot v6.0 Run Finished ---")

if __name__ == "__main__":
    asyncio.run(main())