namespace Brotli {
	[Compact, CCode (cname = "BrotliEncoderState", lower_case_cprefix = "BROTLI_", free_function = "BrotliEncoderDestroyInstance", cheader_filename = "brotli/encode.h")]
	class Encoder {
		public static int MIN_QUALITY;
		public static int MAX_QUALITY;
		public static int DEFAULT_QUALITY;
		[CCode (cname = "BrotliEncoderMode", cprefix = "BROTLI_MODE_")]
		public enum Mode {
			GENERIC,
			TEXT,
			FONT,
		}
		[CCode (cname = "BrotliEncoderOperation", cprefix = "BROTLI_OPERATION_")]
		public enum Operation {
			PROCESS,
			FLUSH,
			FINISH,
			EMIT_METADATA,
		}
		[CCode (cname = "BrotliEncoderParameter", cprefix = "BROTLI_PARAM_")]
		public enum Parameter {
			MODE,
			QUALITY,
			LGWIN,
			LGBLOCK,
			DISABLE_LITERAL_CONTEXT_MODELING,
			SIZE_HINT,
		}
		[CCode (cname = "BrotliEncoderCreateInstance")]
		public Encoder (void* alloc_func = null, void* free_func = null, void* opaque = null);
		[CCode (cname = "BrotliEncoderCompressStream")]
		public bool compressStream (Operation op, ref size_t available_in, [CCode (ctype = "const guint8**")] ref uint8* next_in, ref size_t available_out, ref uint8* next_out, out size_t total_out);
		[CCode (cname = "BrotliEncoderSetParameter")]
		public bool setParameter (Parameter param, uint32 value);
		[CCode (cname = "BrotliEncoderIsFinished")]
		public bool isFinished ();
	}
}
