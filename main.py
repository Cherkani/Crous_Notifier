import json
from datetime import datetime
from os import getenv, path

import requests
import discord
from bs4 import BeautifulSoup
from discord.ext import tasks, commands
from dotenv import load_dotenv

load_dotenv()

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=">", intents=intents)

BOT_TOKEN = getenv("BOT_TOKEN")

prev_results = {}
started_tasks = {}

TASKS_FILE = "tasks.json"

def create_loop(ctx, url):
    @tasks.loop(minutes=1)
    async def loop_inner():
        await scrap(ctx, url)
    return loop_inner

# ---------- Chargement et sauvegarde ----------

def load_tasks():
    if path.exists(TASKS_FILE):
        with open(TASKS_FILE, "r") as f:
            return json.load(f)
    return {}

def save_tasks(tasks_data):
    with open(TASKS_FILE, "w") as f:
        json.dump(tasks_data, f)

# ---------- Fonction de scraping ----------

async def scrap(ctx: commands.context.Context, url: str) -> None:
    current_time = datetime.now().strftime("%H:%M")
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"[{datetime.now().strftime('%H:%M')}] Erreur de requête : {e}")
        embed = discord.Embed(title="Erreur lors du téléchargement.", description=str(e), color=0xc20000)
        await ctx.author.send(embed=embed)
        return

    if response.status_code != 200:
        print(f"[{current_time}] Erreur de téléchargement.")
        embed = discord.Embed(title="Erreur lors du téléchargement de la page.", color=0xc20000)
        await ctx.author.send(embed=embed)
        return

    soup = BeautifulSoup(response.text, "html.parser")
    elements = soup.find_all("div", class_="fr-card svelte-12dfls6")
    names = {element.find("a").text for element in elements}

    if not names:
        print(f"[{current_time}] Aucun logement trouvé.")
        prev_results[ctx.author.id] = names
        return

    new_names = names - prev_results.get(ctx.author.id, set())

    if not new_names:
        print(f"[{current_time}] Aucun nouveau logement.")
        return

    prev_results[ctx.author.id] = names
    print(f"[{current_time}] Logement.s trouvé.s ({len(new_names)}):")
    print("-" + "\n-".join(new_names))

    embed = discord.Embed(
        title=f"Logement.s trouvé.s ({len(new_names)}):",
        description="-" + "\n-".join(new_names),
        color=0x0f8000
    )
    await ctx.author.send(embed=embed)

# ---------- Commande START ----------

@bot.command(name="start")
async def start(ctx: commands.context.Context, arg: str = None) -> None:
    if ctx.author.id in started_tasks:
        await ctx.channel.send(embed=discord.Embed(title="Recherche déjà en cours.", color=0xc20000))
        return

    if arg is None:
        await ctx.channel.send(embed=discord.Embed(title="Aucune URL entrée.", color=0xc20000))
        return

    loop = create_loop(ctx, arg)
    loop.start()
    started_tasks[ctx.author.id] = loop
    prev_results[ctx.author.id] = set()

    # Mémorise la tâche
    tasks_data = load_tasks()
    tasks_data[str(ctx.author.id)] = arg
    save_tasks(tasks_data)

    print(f"[{datetime.now().strftime('%H:%M')}] Recherche commencée.")
    await ctx.channel.send(embed=discord.Embed(title="Recherche commencée.", color=0x0f8000))

# ---------- Commande STOP ----------

@bot.command(name="stop")
async def stop(ctx: commands.context.Context) -> None:
    uid = ctx.author.id

    if uid not in started_tasks:
        await ctx.channel.send(embed=discord.Embed(title="Aucune recherche en cours.", color=0xc20000))
        return

    started_tasks[uid].cancel()
    del started_tasks[uid]
    del prev_results[uid]

    # Supprime du fichier
    tasks_data = load_tasks()
    tasks_data.pop(str(uid), None)
    save_tasks(tasks_data)

    print(f"[{datetime.now().strftime('%H:%M')}] Recherche arrêtée.")
    await ctx.channel.send(embed=discord.Embed(title="Recherche arrêtée.", color=0xc20000))

# ---------- Lancement auto après redémarrage ----------

@bot.event
async def on_ready():
    print(f"[{datetime.now().strftime('%H:%M')}] Bot en ligne.")

    tasks_data = load_tasks()
    for uid_str, url in tasks_data.items():
        uid = int(uid_str)
        user = await bot.fetch_user(uid)
        loop = create_loop(user, url)
        loop.start()
        started_tasks[uid] = loop
        prev_results[uid] = set()

        print(f"[{datetime.now().strftime('%H:%M')}] Reprise auto pour {user.name}.")

# ---------- Lancement du bot ----------

bot.run(BOT_TOKEN)
