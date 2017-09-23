namespace XXH32 {
	[Compact, CCode (cname = "XXH32_state_t", lower_case_cprefix = "XXH32_", free_function = "XXH32_freeState", cheader_filename = "xxhash.h")]
	class State {
		[CCode (cname = "XXH32_createState")]
		public State ();
		public void update (void* input, size_t length);
		public Hash digest ();
		public Hash reset (Hash seed = 0);
	}
	[IntegerType (rank = 7), CCode (cname = "XXH32_hash_t")]
	struct Hash {}
}

namespace XXH64 {
	[Compact, CCode (cname = "XXH64_state_t", lower_case_cprefix = "XXH64_", free_function = "XXH64_freeState", cheader_filename = "xxhash.h")]
	class State {
		[CCode (cname = "XXH64_createState")]
		public State ();
		public void update (void* input, size_t length);
		public Hash digest ();
		public Hash reset (Hash seed = 0);
	}
	[IntegerType (rank = 11), CCode (cname = "XXH64_hash_t")]
	struct Hash {}
}
