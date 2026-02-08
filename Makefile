.PHONY: help backend frontend dev

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

backend: ## Run the backend server with uvicorn
	cd backend && uv run uvicorn main:app --reload --port 8000

frontend: ## Run the frontend dev server with vite
	cd frontend && npm run dev

dev: ## Run both backend and frontend in parallel
	@make -j 2 backend frontend
