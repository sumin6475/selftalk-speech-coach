# MongoDB collection names
COLLECTIONS = {
    "sessions": "sessions",
    "transcripts": "transcripts",
    "checklist_items": "checklist_items",
    "notes": "notes",
    "reports": "reports",
    "drill_expressions": "drill_expressions",
    "drill_expression_usage": "drill_expression_usage",
}

# Indexes to create on init_db()
# Each entry: (collection_name, index_keys, options)
INDEXES = [
    ("sessions", [("created_at", -1)], {}),
    ("transcripts", [("session_id", 1), ("timestamp", 1)], {}),
    ("checklist_items", [("session_id", 1), ("item_index", 1)], {"unique": True}),
    ("notes", [("updated_at", -1)], {}),
    ("reports", [("session_id", 1)], {}),
    ("drill_expressions", [("created_at", -1)], {}),
    ("drill_expression_usage", [("session_id", 1), ("expression_id", 1)], {"unique": True}),
]
