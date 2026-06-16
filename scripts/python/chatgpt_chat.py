"""
Chat multi-turn con OpenAI Responses API + server MCP
======================================================
Una vera chat interattiva dove:
  - L'utente scrive domande in un loop
  - GPT può invocare tool MCP durante la conversazione
  - Il contesto si accumula turno dopo turno
  - Si possono ispezionare le tool call MCP ad ogni turno

Requisiti:
    pip install openai
    export OPENAI_API_KEY="sk-..."

Il server MCP deve essere in ascolto (es. python my_mcp_server.py --http
poi ngrok http 8000 per esporlo).
"""

from openai import OpenAI

client = OpenAI()

# ── Configurazione ────────────────────────────────────────────────

MODEL = "gpt-4.1"

MCP_TOOLS = [
    {
        "type": "mcp",
        "server_label": "demo",
        "server_url": "https://mcp.supabase.com/mcp?project_ref=mquqzsufrtmwnkfbjejj",
        "require_approval": "never",
    },
]

SYSTEM_PROMPT = (
    "Che tabelle ci sono nel DB."
)


# ── Helpers per ispezionare la risposta ───────────────────────────

def dump_response(response):
    """Stampa ogni blocco della risposta, evidenziando le MCP call."""
    for item in response.output:
        if item.type == "mcp_call":
            print(f"  🔧 MCP call: {item.name}({item.arguments})")
            # item.output contiene il JSON restituito dal server MCP
            output_preview = (item.output or "")[:200]
            print(f"     ↳ risultato: {output_preview}")
        elif item.type == "mcp_list_tools":
            print(f"  📋 Tool scoperti dal server MCP")
        elif item.type == "message":
            # Il testo generato dal modello
            for content in item.content:
                if content.type == "output_text":
                    pass  # lo stampiamo dopo con output_text
    return response.output_text


# ── Loop di chat ──────────────────────────────────────────────────

def chat():
    print("=" * 60)
    print("  Chat con GPT + MCP Server")
    print("  Scrivi 'quit' per uscire, 'debug' per toggle dettagli")
    print("=" * 60)

    previous_response_id = None
    show_debug = False
    turn = 0

    while True:
        # Leggi input utente
        try:
            user_input = input("\n👤 Tu: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nCiao!")
            break

        if not user_input:
            continue
        if user_input.lower() == "quit":
            print("Ciao!")
            break
        if user_input.lower() == "debug":
            show_debug = not show_debug
            print(f"  [debug {'ON' if show_debug else 'OFF'}]")
            continue

        turn += 1

        # ── Costruisci la richiesta ──────────────────────────────
        # Al primo turno passiamo anche il system prompt come
        # istruzione iniziale nella lista input.
        # Nei turni successivi basta il messaggio utente +
        # previous_response_id per mantenere il contesto.

        if turn == 1:
            input_messages = [
                {"role": "developer", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_input},
            ]
        else:
            input_messages = [
                {"role": "user", "content": user_input},
            ]

        # ── Chiamata API ─────────────────────────────────────────
        try:
            response = client.responses.create(
                model=MODEL,
                tools=MCP_TOOLS,
                input=input_messages,
                previous_response_id=previous_response_id,
            )
        except Exception as e:
            print(f"  ❌ Errore API: {e}")
            continue

        # Salva l'id per il prossimo turno (il contesto si accumula)
        previous_response_id = response.id

        # ── Mostra la risposta ───────────────────────────────────
        if show_debug:
            print(f"\n  ── Turno {turn} | response.id={response.id} ──")
            text = dump_response(response)
            print(f"\n🤖 GPT: {text}")
        else:
            print(f"\n🤖 GPT: {response.output_text}")


# ── Esempio NON interattivo (scripted) ────────────────────────────

def scripted_chat():
    """
    Stessa logica, ma con domande pre-programmate.
    Utile per test e demo senza input da terminale.
    """
    questions = [
        "Cerca i documenti sul progetto Apollo",
        "Qual è lo stato attuale del sistema?",
        "Crea un task per Mario: 'Aggiornare la documentazione API', priorità alta",
        "Riepilogami cosa abbiamo fatto in questa conversazione",
    ]

    previous_response_id = None

    for i, question in enumerate(questions):
        print(f"\n{'─' * 50}")
        print(f"👤 Tu: {question}")

        if i == 0:
            input_messages = [
                {"role": "developer", "content": SYSTEM_PROMPT},
                {"role": "user", "content": question},
            ]
        else:
            input_messages = [
                {"role": "user", "content": question},
            ]

        response = client.responses.create(
            model=MODEL,
            tools=MCP_TOOLS,
            input=input_messages,
            previous_response_id=previous_response_id,
        )

        previous_response_id = response.id

        # Mostra le eventuali MCP call
        for item in response.output:
            if item.type == "mcp_call":
                print(f"  🔧 MCP → {item.name}({item.arguments})")

        print(f"\n🤖 GPT: {response.output_text}")

    print(f"\n{'─' * 50}")
    print("Fine della conversazione scripted.")


# ── Main ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if "--scripted" in sys.argv:
        scripted_chat()
    else:
        chat()