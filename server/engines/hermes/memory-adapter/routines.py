"""The LilBot routine tools: the server owns schedules and execution history."""
SCHEDULE = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["interval", "daily", "weekly"]},
        "seconds": {"type": "integer", "description": "For interval: at least 300 seconds (5 minutes)."},
        "time": {"type": "string", "description": "For daily/weekly: HH:MM, e.g. 08:00."},
        "timeZone": {"type": "string", "description": "IANA time zone, defaults to Australia/Adelaide."},
        "day": {"type": "integer", "description": "For weekly: Sunday=0 through Saturday=6."},
    },
    "required": ["kind"],
}
TOOLS = [{
    "name": "create_routine",
    "description": "Schedule work for yourself in LilBot. Use this instead of Hermes cron. No confirmation or approval. Each run is a separate session in your folder and its result appears only in Routines. Set createdBy=oscar only when Oscar explicitly requested the schedule; otherwise bot (limit 5, including paused). Reuse requestId on retries. A scheduled run is not a new request from Oscar.",
    "parameters": {"type": "object", "properties": {
        "requestId": {"type": "string"}, "description": {"type": "string"},
        "schedule": SCHEDULE, "createdBy": {"type": "string", "enum": ["oscar", "bot"]},
    }, "required": ["requestId", "description", "schedule", "createdBy"]},
}, *[{
    "name": f"{action}_routine" if action != "list" else "list_routines",
    "description": f"{action.capitalize()} your own LilBot routines. No confirmation needed.",
    "parameters": {"type": "object", "properties": {} if action == "list" else {"id": {"type": "string"}},
                   "required": [] if action == "list" else ["id"]},
} for action in ["list", "pause", "resume", "delete"]]]

ACTIONS = {tool["name"]: action for tool, action in zip(TOOLS, ["create", "list", "pause", "resume", "delete"])}
