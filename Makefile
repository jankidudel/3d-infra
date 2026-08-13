SHELL := /bin/sh

INFRA_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PROCESSOR_DIR ?= $(abspath $(INFRA_DIR)/../3d-processor)
PROCESSOR_ARTIFACT := $(PROCESSOR_DIR)/artifacts/lambda
TEST_ARTIFACT := $(INFRA_DIR)/test/fixtures/processor
STAGE ?= dev

.PHONY: help check processor-package synth-fast synth-real diff-dev deploy-dev destroy-dev

help:
	@echo "make check              Run processor and infrastructure checks"
	@echo "make synth-fast         Synthesize with the test artifact (no .NET build)"
	@echo "make synth-real         Package the processor and synthesize the real stack"
	@echo "make diff-dev           Package the processor and show the dev AWS diff"
	@echo "make deploy-dev         Package the processor and deploy dev"
	@echo "make destroy-dev        Destroy dev (processor artifact not required)"

check:
	cd "$(PROCESSOR_DIR)" && dotnet test 3d-processor.slnx --nologo
	npm run precommit

processor-package:
	cd "$(PROCESSOR_DIR)" && ./scripts/package-lambda.sh

synth-fast:
	npm run test:synth

synth-real: processor-package
	PROCESSOR_ARTIFACT_PATH="$(PROCESSOR_ARTIFACT)" npm run synth -- -c stage=$(STAGE)

diff-dev: processor-package
	PROCESSOR_ARTIFACT_PATH="$(PROCESSOR_ARTIFACT)" npm run diff -- -c stage=dev

deploy-dev: processor-package
	PROCESSOR_ARTIFACT_PATH="$(PROCESSOR_ARTIFACT)" npm run deploy -- -c stage=dev

destroy-dev:
	PROCESSOR_ARTIFACT_PATH="$(TEST_ARTIFACT)" npx cdk destroy -c stage=dev
