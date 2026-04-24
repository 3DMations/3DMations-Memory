.PHONY: up down logs db reset test build status

up:
	docker compose up -d --build

down:
	docker compose stop

logs:
	docker compose logs -f --tail=100

db:
	docker compose exec db psql -U hub -d memories

reset:
	docker compose down -v

test:
	docker compose exec app pnpm test

build:
	docker compose build

status:
	docker compose ps
