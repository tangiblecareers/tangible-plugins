# Changelog

## [0.3.0](https://github.com/tangiblecareers/tangible-plugins/compare/tangible-pbl-v0.2.1...tangible-pbl-v0.3.0) (2026-08-06)


### Features

* **tangible-pbl:** add the sub-content-unit, skill and artifact API ([50cd9dd](https://github.com/tangiblecareers/tangible-plugins/commit/50cd9dd27604947c27768d1fab5e87c308dd07f6))
* **tangible-pbl:** address resources by name and guard publish on its precondition ([dc757cc](https://github.com/tangiblecareers/tangible-plugins/commit/dc757cc488bdfa144988d151ffc4ee14663a335a))
* **tangible-pbl:** create sub-content units and assign skills at the detail gate ([8d3e7b5](https://github.com/tangiblecareers/tangible-plugins/commit/8d3e7b5d51dac582f09ee37198c2e2caead41769))
* **tangible-pbl:** drive the detail and artifacts gates from the tools layer ([7f81449](https://github.com/tangiblecareers/tangible-plugins/commit/7f81449498a45e926a322abcfd37ca69296110c9))
* **tangible-pbl:** generate artifacts at their own gate ([fc553d3](https://github.com/tangiblecareers/tangible-plugins/commit/fc553d3277098ec1cc422060d9b0ab094856c092))
* **tangible-pbl:** validate and resolve a sub-unit breakdown before any write ([a3a022c](https://github.com/tangiblecareers/tangible-plugins/commit/a3a022c63cd4f820c16564846a767da2dde60af1))


### Bug Fixes

* **tangible-pbl:** close six review-flagged gaps in the detail and artifacts gates ([93dd0ea](https://github.com/tangiblecareers/tangible-plugins/commit/93dd0ea16116a236aed6f9586e08732e936dd536))
* **tangible-pbl:** redact UUIDs from backend error messages at the source ([d199d36](https://github.com/tangiblecareers/tangible-plugins/commit/d199d3637a650ad292774ae8fefb546f8ff59b2c))

## [0.2.1](https://github.com/tangiblecareers/tangible-plugins/compare/tangible-pbl-v0.2.0...tangible-pbl-v0.2.1) (2026-08-06)


### Bug Fixes

* **tangible-pbl:** resolve the course id wherever the API puts it ([9a34c23](https://github.com/tangiblecareers/tangible-plugins/commit/9a34c232f0f69e41657ef65e266c245ab33b6710))

## [0.2.0](https://github.com/tangiblecareers/tangible-plugins/compare/tangible-pbl-v0.1.0...tangible-pbl-v0.2.0) (2026-08-06)


### Features

* **tangible-pbl:** add append-only course memory store ([6330484](https://github.com/tangiblecareers/tangible-plugins/commit/6330484b3bd29258b308969e16093b8a6075f414))
* **tangible-pbl:** add course memory frontmatter codec ([8f70127](https://github.com/tangiblecareers/tangible-plugins/commit/8f701275b0ba1c0e4c94552e6db0ee54bedb0224))
* **tangible-pbl:** derive course slugs from title or brief ([7f370b6](https://github.com/tangiblecareers/tangible-plugins/commit/7f370b645ee77a9e4341e0b2d245d76724e9e5e1))
* **tangible-pbl:** log gate decisions to course memory and add pbl_resume ([9aa32d0](https://github.com/tangiblecareers/tangible-plugins/commit/9aa32d0049f6148bd0aa0a7350dc919087a370d0))
* **tangible-pbl:** reconcile course memory against the live course ([0865526](https://github.com/tangiblecareers/tangible-plugins/commit/0865526f4458c95601b5ffc8983fd89bfed65706))


### Bug Fixes

* **marketplace:** restore tangible-pbl entry, add plugin CLAUDE.md ([18e37a6](https://github.com/tangiblecareers/tangible-plugins/commit/18e37a6e181e9603e489f71ffb14ee259f86d831))
* **tangible-pbl:** fail loudly instead of bricking a course memory file ([3eb6795](https://github.com/tangiblecareers/tangible-plugins/commit/3eb67959070e4711e3d810192015696daeb50d95))
* **tangible-pbl:** list businesses from the profile, like the web app ([5b24631](https://github.com/tangiblecareers/tangible-plugins/commit/5b246311b40d82d3ef47c92aa7bb7522d5227cad))
* **tangible-pbl:** log pbl_revise's kept-skills and chosen-problem decisions too ([1fa9017](https://github.com/tangiblecareers/tangible-plugins/commit/1fa90174981a99f74d14e46ccde7b3223ec3bef3))
* **tangible-pbl:** mark courses published on approve, log the human's gate decisions ([71dde55](https://github.com/tangiblecareers/tangible-plugins/commit/71dde5576a111e0e48788634efc44ccec2cd4dcd))
* **tangible-pbl:** reconcile the ARCHIVED course status, cover every difference branch for id leakage ([9e1d0a3](https://github.com/tangiblecareers/tangible-plugins/commit/9e1d0a3b8956f8f2591441948f12ea0cf259b348))
* **tangible-pbl:** stop pbl_abort and #parse from silently losing state ([1c8ca2d](https://github.com/tangiblecareers/tangible-plugins/commit/1c8ca2d68189e7a96e3dfd772b6a2b6877c6fad7))
* **tangible-pbl:** stop save() clobbering corrupt files, trim brief, dedupe tmp names ([1a8e80a](https://github.com/tangiblecareers/tangible-plugins/commit/1a8e80a3c8d4b5aa2638455c93af551717b6d84a))
* **tangible-pbl:** store owns the updated timestamp, not the caller ([6e26663](https://github.com/tangiblecareers/tangible-plugins/commit/6e26663e9c89ab1b1ad20cd947a088df90239fd9))
* **tangible-pbl:** surface the API URL and name 404 paths ([4c1a022](https://github.com/tangiblecareers/tangible-plugins/commit/4c1a022b247d6ab7fa9703e41cd746fe513ddab9))
