namespace Brotli {
	[Compact, CCode (cname = "BrotliDecoderState", free_function = "BrotliDecoderDestroyInstance", cheader_filename = "brotli/decode.h")]
	class Decoder {
		[CCode (cname = "BrotliDecoderResult", cprefix = "BROTLI_DECODER_RESULT_")]
		public enum Result {
			ERROR,
			SUCCESS,
			NEEDS_MORE_INPUT,
			NEEDS_MORE_OUTPUT,
		}
		[CCode (cname = "BrotliDecoderCreateInstance")]
		public Decoder (void* alloc_func = null, void* free_func = null, void* opaque = null);
		[CCode (cname = "BrotliDecoderDecompressStream")]
		public Result decompressStream (ref size_t available_in, [CCode (type = "const guint8**")] ref uint8* next_in, ref size_t available_out, ref uint8* next_out, out size_t total_out);
	}
}
