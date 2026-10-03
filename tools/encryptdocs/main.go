// Шифрование PDF-документов и секретных HTML-фрагментов для страницы «Документы».
//
// Использование:
//
//	DOCS_PASSWORD=... go run ./tools/encryptdocs -in ../kosta-rica/documents -extra .tmp-secret -out docs
//
// -in    — каталог с PDF (шифруются как doc-NN.bin, порядок по имени)
// -extra — дополнительный каталог (например, .tmp-secret с фрагментами из build.py);
//
// файлы из него шифруются как <имя>.bin (secret-marshrut.html → secret-marshrut.html.bin)
//
// Формат *.bin:  magic "CRDOC1\0" | salt(16) | nonce(12) | AES-256-GCM(ciphertext)
// manifest.bin — тот же формат, внутри JSON со списком файлов.
//
// PBKDF2-HMAC-SHA256, 210 000 итераций — совпадает с настройками в assets/js/docs.js.
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	magic      = "CRDOC1\x00"
	iterations = 210_000
	keyLen     = 32
	saltLen    = 16
	nonceLen   = 12
)

type manifestEntry struct {
	Name string `json:"name"` // оригинальное имя файла
	Enc  string `json:"enc"`  // имя зашифрованного файла
	Size int64  `json:"size"` // размер исходного PDF
}

// pbkdf2SHA256 — реализация RFC 8018 без внешних зависимостей.
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	blocks := (keyLen + hashLen - 1) / hashLen
	out := make([]byte, 0, blocks*hashLen)

	buf := make([]byte, 4)
	for block := 1; block <= blocks; block++ {
		prf.Reset()
		prf.Write(salt)
		binary.BigEndian.PutUint32(buf, uint32(block))
		prf.Write(buf)
		u := prf.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iter; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func join(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func main() {
	inDir := flag.String("in", "../kosta-rica/documents", "каталог с PDF")
	extraDir := flag.String("extra", "", "доп. каталог (HTML-фрагменты из build.py, опционально)")
	outDir := flag.String("out", "docs", "каталог для зашифрованных файлов")
	password := flag.String("password", "", "пароль (или env DOCS_PASSWORD)")
	flag.Parse()

	pw := *password
	if pw == "" {
		pw = os.Getenv("DOCS_PASSWORD")
	}
	if pw == "" {
		fmt.Fprintln(os.Stderr, "нужен пароль: -password или DOCS_PASSWORD")
		os.Exit(1)
	}

	entries, err := os.ReadDir(*inDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "чтение входного каталога:", err)
		os.Exit(1)
	}

	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".pdf") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		fmt.Fprintln(os.Stderr, "PDF не найдены в", *inDir)
		os.Exit(1)
	}

	// файлы из -extra: имя шифрата = <имя>.bin (стабильная ссылка из HTML)
	type srcFile struct{ path, name, enc string }
	files := make([]srcFile, 0, len(names))
	for i, name := range names {
		files = append(files, srcFile{
			path: filepath.Join(*inDir, name),
			name: name,
			enc:  fmt.Sprintf("doc-%02d.bin", i+1),
		})
	}
	if *extraDir != "" {
		extra, err := os.ReadDir(*extraDir)
		if err != nil {
			fmt.Fprintln(os.Stderr, "чтение -extra:", err)
			os.Exit(1)
		}
		var extraNames []string
		for _, e := range extra {
			if !e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				extraNames = append(extraNames, e.Name())
			}
		}
		sort.Strings(extraNames)
		for _, name := range extraNames {
			files = append(files, srcFile{
				path: filepath.Join(*extraDir, name),
				name: name,
				enc:  name + ".bin",
			})
		}
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	// encryptOne: данные → blob формата CRDOC1 (salt|nonce|AES-GCM)
	encryptOne := func(data []byte) []byte {
		salt := randomBytes(saltLen)
		key := pbkdf2SHA256([]byte(pw), salt, iterations, keyLen)
		block, err := aes.NewCipher(key)
		if err != nil {
			panic(err)
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			panic(err)
		}
		nonce := randomBytes(nonceLen)
		return join([]byte(magic), salt, nonce, gcm.Seal(nil, nonce, data, nil))
	}

	// manifest шифруется общим ключом (свой salt)
	manifestSalt := randomBytes(saltLen)
	manifestKey := pbkdf2SHA256([]byte(pw), manifestSalt, iterations, keyLen)

	list := make([]manifestEntry, 0, len(files))
	for _, f := range files {
		data, err := os.ReadFile(f.path)
		if err != nil {
			fmt.Fprintln(os.Stderr, f.name, err)
			os.Exit(1)
		}
		blob := encryptOne(data)
		if err := os.WriteFile(filepath.Join(*outDir, f.enc), blob, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, f.enc, err)
			os.Exit(1)
		}
		list = append(list, manifestEntry{Name: f.name, Enc: f.enc, Size: int64(len(data))})
		fmt.Printf("  %s  ← %s (%d KB)\n", f.enc, f.name, len(data)/1024)
	}

	jsonList, err := json.Marshal(list)
	if err != nil {
		panic(err)
	}
	// тот же формат, что и у doc-XX.bin
	block, _ := aes.NewCipher(manifestKey)
	gcm, _ := cipher.NewGCM(block)
	nonce := randomBytes(nonceLen)
	manifestBlob := join([]byte(magic), manifestSalt, nonce, gcm.Seal(nil, nonce, jsonList, nil))
	if err := os.WriteFile(filepath.Join(*outDir, "manifest.bin"), manifestBlob, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fmt.Printf("готово: %d файлов → %s\n", len(list), *outDir)
}
