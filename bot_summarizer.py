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
    """Fetches deal URL and Title from the temporary log file."""
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
    """Deletes the daily log file after processing."""
    try:
        if os.path.exists(filename):
            os.remove(filename)
            logging.info(f"Cleared '{filename}' for the next cycle.")
    except Exception as e:
        logging.error(f"Failed to clear daily log: {e}")

def sanitize_markdown_v2(text: str) -> str:
    """
    Escapes characters for Telegram's MarkdownV2.
    This should ONLY be used on content, NOT on formatting characters like '*' or '[]()'.
    """
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    # In the replacement string, '\\' is a literal backslash, so '\\1' means "a backslash followed by the matched character".
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

async def get_summary_from_gemini(api_key, deals_data):
    """Sends data to Gemini and gets a structured summary."""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-flash-latest')

    formatted_deals = "\n".join([f"Title: {title}\nURL: {url}" for url, title in deals_data])

    # NEW PROMPT: Asks for structured data, not pre-formatted Markdown.
    prompt = f"""
    You are the "Hoard-Watcher's Chronicler," a helpful gaming news analyst. Your task is to analyze the following list of game deal titles and their URLs. Generate a clean, concise summary digest.

    Your output MUST follow this exact structure, using "|" as a separator:
    TITLE: [A main title for the digest, including today's date]
    OVERVIEW: [A brief, one-sentence overview of the deals]
    DEAL: [Game Title]|[Platform]|[URL]
    DEAL: [Another Game Title]|[Another Platform]|[Another URL]
    ...

    - You MUST infer the platform (Steam, Epic, GOG, etc.) from the title or URL.
    - You MUST filter out junk like discussion threads, PSAs, DLC, and in-game loot.
    - If no actual free games are found, output only a TITLE and an OVERVIEW line explaining that.

    Here is the data. Create the summary.

    --- DATA ---
    {formatted_deals}
    --- END DATA ---
    """
    try:
        logging.info("Sending request to Gemini API...")
        response = await model.generate_content_async(prompt)
        logging.info("Received response from Gemini API.")
        # Ensure we return a clean string, even if the response is None or complex
        return response.text or ""
    except Exception as e:
        logging.error(f"Error calling Gemini API: {e}")
        return "ERROR: Failed to generate summary due to an API error."

async def send_telegram_message(bot_token, chat_id, message):
    """Sends a pre-formatted, pre-sanitized message to Telegram."""
    if not message:
        logging.warning("Attempted to send an empty message. Aborting.")
        return
    try:
        bot = Bot(token=bot_token)
        await bot.send_message(chat_id=chat_id, text=message, parse_mode=ParseMode.MARKDOWN_V2)
        logging.info("Successfully sent summary to Telegram.")
    except TelegramError as e:
        # The message is already perfectly formatted, so any error is critical.
        logging.error(f"FATAL Telegram API Error: {e}")
        logging.error(f"Message Content that failed:\n---\n{message}\n---")


async def main():
    logging.info("--- Summarizer Bot v4.0 (Surgical) Run Started ---")

    # --- Step 1: Load Config and Credentials ---
    is_github_action = os.getenv('GITHUB_ACTIONS') == 'true'
    if is_github_action:
        telegram_token = os.getenv('TELEGRAM_TOKEN')
        chat_id = os.getenv('TELEGRAM_CHAT_ID')
        gemini_api_key = os.getenv('GEMINI_API_KEY')
    else:
        config = configparser.ConfigParser()
        config.read('config.ini')
        telegram_token = config['telegram']['token']
        chat_id = config['telegram']['chat_id']
        gemini_api_key = config['gemini']['api_key']

    if not all([telegram_token, chat_id, gemini_api_key]):
        logging.error("One or more required credentials are missing. Aborting.")
        return

    # --- Step 2: Get Pending Deals ---
    log_file = "daily_deals.txt"
    pending_deals = get_pending_deals(log_file)
    if not pending_deals:
        logging.info("No new deals to summarize. Exiting.")
        return

    logging.info(f"Found {len(pending_deals)} unique deals to process.")

    # --- Step 3: Get Structured Data from AI ---
    structured_summary = await get_summary_from_gemini(gemini_api_key, pending_deals)
    if structured_summary.startswith("ERROR:"):
        # If the API fails, send a simple error message.
        await send_telegram_message(telegram_token, chat_id, sanitize_markdown_v2(structured_summary))
        return

    # --- Step 4: Build the Final Message Surgically ---
    message_parts = []
    deal_lines = []
    
    # Parse the AI's structured response
    for line in structured_summary.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
            
        if line.startswith("TITLE:"):
            title_text = sanitize_markdown_v2(line.replace("TITLE:", "", 1).strip())
            message_parts.append(f"*{title_text}*") # Apply bold formatting
        elif line.startswith("OVERVIEW:"):
            overview_text = sanitize_markdown_v2(line.replace("OVERVIEW:", "", 1).strip())
            message_parts.append(f"\n_{overview_text}_") # Apply italic formatting
        elif line.startswith("DEAL:"):
            try:
                # Unpack the deal, expecting "DEAL: Title|Platform|URL"
                _, data = line.split(":", 1)
                title, platform, url = data.strip().split('|', 2)
                
                # Sanitize EACH part of the content individually
                sanitized_title = sanitize_markdown_v2(title.strip())
                sanitized_platform = sanitize_markdown_v2(platform.strip())
                # The URL itself in [text](URL) doesn't need escaping
                url = url.strip()

                # Build the MarkdownV2 line with our own formatting
                deal_lines.append(f"• *{sanitized_title}* on `{sanitized_platform}` ([Link]({url}))")
            except ValueError:
                logging.warning(f"Could not parse deal line: {line}")

    if deal_lines:
        message_parts.append("\n" + "\n".join(deal_lines))

    # Add the standard footer, which is already correctly escaped.
    footer = "\n\n_This summary was automatically generated by the Hoard\\-Watcher's Chronicler\\._"
    
    final_message = "\n".join(message_parts) + footer

    # --- Step 5: Send the Perfectly Formatted Message ---
    await send_telegram_message(telegram_token, chat_id, final_message)
    clear_daily_log(log_file)
    logging.info("--- Summarizer Bot v4.0 Run Finished ---")


if __name__ == "__main__":
    asyncio.run(main())