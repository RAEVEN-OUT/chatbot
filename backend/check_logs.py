
from app.repositories.factory import get_repository
from app.core.config import settings

def check_recent_logs():
    repo = get_repository()
    logs = repo.list_logs()
    # Sort by ID or creation if possible (assuming higher ID is newer for now or just take last)
    # Since list_logs is simple, we'll just look at the last few.
    for log in logs[-5:]:
        if "medical emergency" in log.question.lower():
            print(f"Question: {log.question}")
            print(f"Answer: {log.answer}")
            print(f"Matched FAQ ID: {log.matched_faq_id}")
            print(f"Response Type: {log.response_type}")
            print("---")

if __name__ == "__main__":
    check_recent_logs()
