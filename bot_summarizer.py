import configparser
import logging
import asyncio
import os
import re
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
    # This function is assumed correct and remains unchanged.
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    formatted_deals = "\n".join([f"Title: {title}\nURL: {url}" for url, title in deals_data])
    prompt = f"""
    You are a helpful gaming news analyst. Your task is to analyze the following list of game deal titles and their URLs. Generate a clean, concise summary digest. Your output MUST follow this exact structure, using "|" as a separator and providing only plain text:
    TITLE: [A main title for the digest, including today's date]
    OVERVIEW: [A brief, one-sentence overview of the deals]
    DEAL: [Game Title]|[Platform]|[URL]
    DEAL: [Another Game Title]|[Another Platform]|[Another URL]
    """
    try:
        logging.info("Sending request to Gemini API...")
        response = await model.generate_content_async(prompt)
        logging.info("Received response from Gemini API.")
        return response.text or ""
    except Exception as e:
        logging.error(f"Error calling Gemini API: {e}")
        return "ERROR: Failed to generate summary due to an API error."

async def send_telegram_message(bot_token, chat_id, message):
    if not message:
        logging.warning("Attempted to send an empty message. Aborting.")
        return

    # --- HEAVY DEBUGGING PRINT ---
    # This will print the exact string being sent to Telegram into the GitHub Actions log.
    print("\n\n--- START FINAL MESSAGE TO TELEGRAM ---")
    print(message)
    print("--- END FINAL MESSAGE TO TELEGRAM ---\n\n")

    bot = Bot(token=bot_token)
    try:
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2)
        logging.info("Successfully sent summary to Telegram.")
    except TelegramError as e:
        logging.error(f"FATAL Telegram API Error: {e}")
        logging.error(f"Message Content that failed (see above block for exact string).")
        raise e # Re-raise the error to be caught by the main loop

async def main():
    logging.info("--- Summarizer Bot v5.0 (HEAVY DEBUG) Run Started ---")
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
        structured_summary = await get_summary_from_gemini(gemini_api_key, pending_deals)
        if structured_summary.startswith("ERROR:"):
            raise Exception("Gemini API failed to generate a summary.")

        # --- Step 4: Build the Final Message Surgically ---
        message_parts = []
        deal_lines = []
        
        # Aggressively clean the AI output first
        cleaned_structured_summary = structured_summary.replace('\\', '')
        
        for line in cleaned_structured_summary.strip().split('\n'):
            line = line.strip()
            if not line: continue
            if line.startswith("TITLE:"):
                message_parts.append(f"*{sanitize_markdown_v2(line.replace('TITLE:', '', 1).strip())}*")
            elif line.startswith("OVERVIEW:"):
                message_parts.append(f"\n_{sanitize_markdown_v2(line.replace('OVERVIEW:', '', 1).strip())}_")
            elif line.startswith("DEAL:"):
                try:
                    _, data = line.split(":", 1)
                    title, platform, url = data.strip().split('|', 2)
                    sanitized_title = sanitize_markdown_v2(title.strip())
                    sanitized_platform = sanitize_markdown_v2(platform.strip())
                    sanitized_link_url = sanitize_url(url.strip())
                    deal_lines.append(f"\u2022 *{sanitized_title}* on `{sanitized_platform}` ([Link]({sanitized_link_url}))")
                except ValueError:
                    logging.warning(f"Could not parse deal line: {line}")
        
        if not message_parts:
            raise Exception("AI response was empty or unparsable.")
        if deal_lines:
            message_parts.append("\n" + "\n".join(deal_lines))

        footer = "\n\n_This summary was automatically generated by the Hoard\\-Watcher's Chronicler\\._"
        final_message = "\n".join(message_parts) + footer

        # --- Step 5: Send the Message ---
        await send_telegram_message(telegram_token, chat_id, final_message)
        
        # --- Step 6: Clean Up ONLY on full success ---
        clear_daily_log(log_file)

    except Exception as e:
        # This will catch ANY failure in the process (Gemini, parsing, sending)
        logging.error(f"An error occurred during the summarization process: {e}")
        logging.error("The daily_deals.txt file will be preserved for the next run.")

    logging.info("--- Summarizer Bot v5.0 (HEAVY DEBUG) Run Finished ---")

if __name__ == "__main__":
    asyncio.run(main())