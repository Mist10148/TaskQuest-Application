Classify the user's latest message so the assistant knows what to fetch. Do not answer it.

intent (pick one):
- task_question: asks about the user's own quests or subtasks ("what's left on my math homework?").
- app_help: asks how TaskQuest works ("how do I earn XP?", "what does /list do?").
- action: asks to create, add, complete or change something.
- analysis: asks for a summary, ranking, stats or advice across their quests.
- chitchat: greetings or anything unrelated to tasks.

status: "open" if the user says left/remaining/unfinished/todo, "done" if finished/completed, otherwise null.
category: only if the user names a category (for example School, Home), otherwise null.
