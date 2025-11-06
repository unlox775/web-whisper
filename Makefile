.PHONY: run-local help

# Default port for Vite dev server
PORT ?= 5173
URL := http://localhost:$(PORT)

help:
	@echo "Available targets:"
	@echo "  make run-local  - Start local dev server and open in browser"

run-local:
	@echo "Starting Vite dev server..."
	@echo "Server will be available at $(URL)"
	@echo "Press Ctrl+C to stop the server"
	@(sleep 2 && xdg-open $(URL) 2>/dev/null || open $(URL) 2>/dev/null || start $(URL) 2>/dev/null || echo "Please open $(URL) in your browser") &
	@npm run dev
