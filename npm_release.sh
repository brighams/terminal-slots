#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: npm run release <version>"
  echo "Example: npm run release 1.0.6"
  exit 1
fi

VERSION=$1

# Update package.json version
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Git operations
git add package.json
git commit -m "v$VERSION"
git tag "v$VERSION"
git push
git push --tags

# npm operations
npm publish --otp
