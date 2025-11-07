.PHONY: run-local help

# Default port for Vite dev server
PORT ?= 5173
URL := http://localhost:$(PORT)

help:
	@echo "Available targets:"
	@echo "  make run-local  - Build to docs/, start dev server, and open in browser"

run-local:
	@echo "Killing any existing servers on port $(PORT)..."
	@lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true
	@sleep 0.5
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	@echo "Building project to docs/..."
	@npm run build
	@echo "Starting dev server..."
	@bash -c 'trap "kill -9 \$$SERVER_PID 2>/dev/null; lsof -ti:$(PORT) | xargs kill -9 2>/dev/null || true; exit" INT TERM; \
	./node_modules/.bin/vite --port $(PORT) & \
	SERVER_PID=$$!; \
	echo "Waiting for server to start..."; \
	ATTEMPTS=0; \
	while [ $$ATTEMPTS -lt 20 ]; do \
		if lsof -ti:$(PORT) > /dev/null 2>&1; then \
			echo "Server is ready!"; \
			sleep 0.5; \
			echo "Opening browser at $(URL)..."; \
			open $(URL) 2>/dev/null || xdg-open $(URL) 2>/dev/null || start $(URL) 2>/dev/null || echo "Please open $(URL) manually"; \
			echo "Dev server is running (PID: $$SERVER_PID). Press Ctrl+C to stop."; \
			wait $$SERVER_PID; \
			exit 0; \
		fi; \
		ATTEMPTS=$$((ATTEMPTS + 1)); \
		sleep 0.5; \
	done; \
	echo "Server failed to start within 10 seconds."; \
	kill $$SERVER_PID 2>/dev/null || true; \
	exit 1'
