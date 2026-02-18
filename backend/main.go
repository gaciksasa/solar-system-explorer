package main

import (
	"log"

	"solar-system-explorer/backend/handlers"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	// CORS - allow Angular dev server
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:4200"},
		AllowMethods:     []string{"GET", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type"},
		AllowCredentials: false,
	}))

	// API routes
	api := r.Group("/api")
	{
		api.GET("/planets", handlers.GetPlanets)
		api.GET("/planets/:name", handlers.GetPlanetByName)
	}

	log.Println("Solar System Explorer API running on http://localhost:8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
