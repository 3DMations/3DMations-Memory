.PHONY: up down logs db session reset test build status

up:
	docker compose up -d --build

down:
	docker compose stop

logs:
	docker compose logs -f --tail=100

db:
	docker compose exec db psql -U hub -d memories

# Onboard a new device/project: mint a session and print its bearer token once.
# Runs inside the app container's netns so it works with the loopback bind.
# usage: make session name=<machine>-<project>
session:
	@test -n "$(name)" || { echo "usage: make session name=<machine>-<project>"; exit 1; }
	@docker compose exec -T app node -e 'fetch("http://127.0.0.1:3000/api/sessions",{method:"POST",headers:{"content-type":"application/json","x-admin-token":process.env.AUTH_SECRET},body:JSON.stringify({name:process.argv[1]})}).then(async r=>{const j=await r.json();console.log(JSON.stringify(j,null,2));process.exitCode=r.ok?0:1})' "$(name)"

reset:
	docker compose down -v

test:
	docker compose exec app pnpm test

build:
	docker compose build

status:
	docker compose ps
