#!/bin/bash
set -e

echo "Deployment started ..."

# Pull the latest version of the app
git pull origin master
echo "New changes copied to server !"

echo "Installing Dependencies..."
npm install --yes

echo "Restarting application process..."
pm2 restart all || pm2 reload all || true

echo "Deployment Finished!"