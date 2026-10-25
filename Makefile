SHELL := /bin/sh

INFRA_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PROCESSOR_DIR ?= $(abspath $(INFRA_DIR)/../3d-processor)
API_DIR ?= $(abspath $(INFRA_DIR)/../3d-api)
FRONTEND_DIR ?= $(abspath $(INFRA_DIR)/../3d-frontend)
PROCESSOR_ARTIFACT := $(PROCESSOR_DIR)/artifacts/3d-processor.zip
API_ARTIFACT := $(API_DIR)/artifacts/3d-api.zip
FRONTEND_ARTIFACT := $(FRONTEND_DIR)/dist/3d-frontend/browser
TEST_ARTIFACT := $(INFRA_DIR)/test/fixtures/processor
TEST_API_ARTIFACT := $(INFRA_DIR)/test/fixtures/api
TEST_FRONTEND_ARTIFACT := $(INFRA_DIR)/test/fixtures/frontend
STAGE ?= prod
AWS_REGION ?= us-east-1
AWS_ACCOUNT_ID = $(shell aws sts get-caller-identity --query Account --output text)

ifneq ($(STAGE),prod)
$(error Hosted development is disabled; STAGE must be prod)
endif
FRONTEND_BUILD_SCRIPT := build
# Future hosted development: replace the production-only guard above with
# validation for prod/dev, then restore the environment-specific build selection:
# ifeq ($(STAGE),dev)
# FRONTEND_BUILD_SCRIPT := build:deployment-development
# endif

.PHONY: help check bootstrap backend-artifacts application-artifacts synth-fast synth-real diff-prod

help:
	@echo "make check              Run checks in all application repositories and infrastructure"
	@echo "make bootstrap          Bootstrap CDK for the active AWS account and region"
	@echo "make synth-fast         Synthesize with test artifacts (no app builds)"
	@echo "make synth-real         Build all apps and synthesize the real stack"
	@echo "make diff-prod          Build all apps and show the production AWS diff"

check:
	cd "$(PROCESSOR_DIR)" && dotnet test 3d-processor.slnx --nologo
	$(MAKE) -C "$(API_DIR)" check
	cd "$(FRONTEND_DIR)" && npm run verify
	npm run precommit

bootstrap:
	PROCESSOR_ARTIFACT_PATH="$(TEST_ARTIFACT)" API_ARTIFACT_PATH="$(TEST_API_ARTIFACT)" FRONTEND_ARTIFACT_PATH="$(TEST_FRONTEND_ARTIFACT)" npx cdk bootstrap "aws://$(AWS_ACCOUNT_ID)/$(AWS_REGION)" -c googleSiteVerification=bootstrap-placeholder

backend-artifacts:
	$(MAKE) -C "$(PROCESSOR_DIR)" package
	$(MAKE) -C "$(API_DIR)" package

application-artifacts: backend-artifacts
	cd "$(FRONTEND_DIR)" && npm run $(FRONTEND_BUILD_SCRIPT)

synth-fast:
	npm run test:synth

synth-real: application-artifacts
	PROCESSOR_ARTIFACT_PATH="$(PROCESSOR_ARTIFACT)" API_ARTIFACT_PATH="$(API_ARTIFACT)" FRONTEND_ARTIFACT_PATH="$(FRONTEND_ARTIFACT)" npm run synth -- -c stage=$(STAGE)

diff-prod: application-artifacts
	PROCESSOR_ARTIFACT_PATH="$(PROCESSOR_ARTIFACT)" API_ARTIFACT_PATH="$(API_ARTIFACT)" FRONTEND_ARTIFACT_PATH="$(FRONTEND_ARTIFACT)" npm run diff -- -c stage=prod
