# Changelog

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
