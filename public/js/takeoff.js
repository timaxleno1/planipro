// Code spécifique à l'onglet TakeOff

// Fonction pour gérer l'interaction avec le canvas
function setupCanvasInteraction(canvas, context, image) {
    let scale = 1; // Facteur de zoom initial
    let isMeasuring = false;
    let startX, startY, endX, endY;
    let lines = [];

    // Fonction pour redessiner l'image et les lignes
    function redraw() {
        context.clearRect(0, 0, canvas.width, canvas.height); // Effacer le canvas
        context.save(); // Sauvegarder le contexte actuel
        context.scale(scale, scale); // Appliquer le facteur de zoom
        context.drawImage(image, 0, 0); // Dessiner l'image
        drawLines(); // Dessiner les lignes
        context.restore(); // Restaurer le contexte sauvegardé
    }

    // Gérer l'événement de la molette de la souris pour le zoom
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        const zoomFactor = 1.002; // Facteur de zoom ajusté pour un zoom plus fluide
        if (event.deltaY < 0) {
            scale *= zoomFactor; // Zoom avant
        } else {
            scale /= zoomFactor; // Zoom arrière
            if (scale < 0.1) scale = 0.1; // Empêcher un zoom trop petit
        }
        redraw(); // Redessiner après le zoom
    });

    document.getElementById('measure-line').addEventListener('click', () => {
        isMeasuring = true;
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mouseup', onMouseUp);
    });

    function onMouseDown(event) {
        startX = event.offsetX / scale;
        startY = event.offsetY / scale;
    }

    function onMouseUp(event) {
        endX = event.offsetX / scale;
        endY = event.offsetY / scale;
        lines.push({ startX, startY, endX, endY });
        drawLines();
        const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)) * parseFloat(document.getElementById('scale').value);
        alert(`Longueur de la ligne: ${length.toFixed(2)} mètres`);
        isMeasuring = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
    }

    function drawLines() {
        context.strokeStyle = 'red';
        context.lineWidth = 2;
        lines.forEach(line => {
            context.beginPath();
            context.moveTo(line.startX, line.startY);
            context.lineTo(line.endX, line.endY);
            context.stroke();
        });
    }

    // Dessin initial
    image.onload = () => {
        canvas.width = image.width;
        canvas.height = image.height;
        redraw();
    };
}
