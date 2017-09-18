VALAC = valac
VALAFLAGS = -X -O3 -X -Wl,-O1

brp: brp.gs libbrotlidec.vapi libbrotlienc.vapi
	$(VALAC) $< --vapidir=. --pkg=libbrotlidec --pkg=libbrotlienc --pkg=posix $(VALAFLAGS)

clean:
	$(RM) brp
