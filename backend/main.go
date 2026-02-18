package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"solar-system-explorer/backend/handlers"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	// API routes
	api := r.Group("/api")
	{
		api.GET("/planets", handlers.GetPlanets)
		api.GET("/planets/:name", handlers.GetPlanetByName)
	}

	// Serve Angular SPA — try the requested static file; fall back to
	// index.html so Angular's client-side router handles unknown paths.
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./frontend/dist/frontend/browser"
	}
	r.NoRoute(spaHandler(staticDir))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Solar System Explorer running on :%s (static: %s)", port, staticDir)
	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

// spaHandler serves static files from staticDir and falls back to index.html
// for any path that doesn't exist (Angular client-side routing).
func spaHandler(staticDir string) gin.HandlerFunc {
	fs := http.Dir(staticDir)
	fileServer := http.FileServer(fs)
	indexPath := filepath.Join(staticDir, "index.html")
	return func(c *gin.Context) {
		f, err := fs.Open(c.Request.URL.Path)
		if err != nil {
			c.File(indexPath)
			return
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil || stat.IsDir() {
			c.File(indexPath)
			return
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	}
}
