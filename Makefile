update:
	git pull --recurse-submodules

install:
	$(MAKE) -C packages install

build:
	$(MAKE) -C packages build
	docker build . -t satellite-earth/personal-node
