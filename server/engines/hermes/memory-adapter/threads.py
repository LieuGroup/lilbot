"""Asynchronous bot exchanges; routing and durable transcripts belong to LilBot."""
TOOLS = [{
    "name": "ask_bot",
    "description": "Ask another LilBot for help. Any bot may ask any other. Returns immediately: continue or finish your turn; an answer arrives as a new turn in this same conversation. Use list_bots to choose an exact name/id. Reuse requestId on retries. Use threadId for follow-ups on the same work; omit for new work. Maximum depth 3, 20 messages/thread; no self-asking. Never poll for an answer. Report to whoever asked you, never automatically to the primary bot.",
    "parameters": {"type": "object", "properties": {
        key: {"type": "string"} for key in ["requestId", "to", "text", "threadId"]
    }, "required": ["requestId", "to", "text"]},
}, {
    "name": "list_bots",
    "description": "List the LilBot ids, names and functions you can ask for help.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}]
ACTIONS = {"ask_bot": "ask", "list_bots": "bots"}
