VALAC = valac
VALAFLAGS = -X -O3 -X -Wl,-O1

all: brzip.gs libbrotlidec.vapi libbrotlienc.vapi xxhash.vapi
	$(VALAC) $< --vapidir=. --pkg=libbrotlidec --pkg=libbrotlienc --pkg=xxhash --pkg=posix $(VALAFLAGS) -X -lxxhash crc32c.c

clean:
	$(RM) brzip
