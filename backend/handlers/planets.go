package handlers

import (
	"net/http"
	"strings"

	"solar-system-explorer/backend/models"

	"github.com/gin-gonic/gin"
)

// GetPlanets returns all solar system bodies
func GetPlanets(c *gin.Context) {
	planets := models.GetSolarSystemBodies()
	c.JSON(http.StatusOK, gin.H{
		"data":  planets,
		"count": len(planets),
	})
}

// GetPlanetByName returns a single planet by name
func GetPlanetByName(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	planets := models.GetSolarSystemBodies()

	for _, planet := range planets {
		if strings.ToLower(planet.Name) == name || strings.ToLower(planet.NameSR) == name {
			c.JSON(http.StatusOK, gin.H{"data": planet})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Planet not found"})
}
