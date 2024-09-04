document.addEventListener('DOMContentLoaded', function () {
    const socket = io();
    let socketId = null;
    let selectedFile = null;

    const fileInput = document.getElementById('pdfFile');
    const uploadButton = document.getElementById('uploadButton');

    console.log("Éléments initiaux :", {
        fileInput: fileInput,
        uploadButton: uploadButton,
        buttonDisabled: uploadButton.disabled
    });

    socket.on('connect', () => {
        console.log('Connecté au serveur Socket.IO');
        socketId = socket.id;
    });

    fileInput.addEventListener('change', function (event) {
        selectedFile = event.target.files[0];
        console.log("Fichier sélectionné :", selectedFile);

        if (selectedFile) {
            console.log("Activation du bouton");
            uploadButton.disabled = false;
            uploadButton.classList.remove('disabled');
        } else {
            console.log("Désactivation du bouton");
            uploadButton.disabled = true;
            uploadButton.classList.add('disabled');
        }

        console.log("État du bouton après changement :", {
            buttonDisabled: uploadButton.disabled,
            buttonClassList: uploadButton.classList
        });
    });

    uploadButton.addEventListener('click', function (event) {
        event.preventDefault();
        console.log("Bouton cliqué");
        if (selectedFile) {
            handleFileUpload(selectedFile);
        } else {
            console.log("Aucun fichier sélectionné pour l'upload");
        }
    });

    function handleFileUpload(file) {
        console.log("Début de l'upload du fichier:", file.name);

        const formData = new FormData();
        formData.append('pdfFile', file);
        formData.append('socketId', socketId);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                console.log("Réponse du serveur après upload:", data);
                if (data.success) {
                    console.log('Fichier uploadé avec succès, démarrage du traitement');
                    return fetch('/process', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ socketId: socketId })
                    });
                } else {
                    throw new Error('Erreur lors de l\'upload du fichier.');
                }
            })
            .then(response => response.json())
            .then(data => {
                console.log("Réponse du serveur après demande de traitement:", data);
                if (data.success) {
                    console.log('Traitement du fichier démarré');
                } else {
                    throw new Error('Erreur lors du démarrage du traitement du fichier.');
                }
            })
            .catch(error => {
                console.error('Erreur:', error);
                alert(error.message);
            })
            .finally(() => {
                // Réinitialiser le formulaire et le bouton
                fileInput.value = '';
                uploadButton.disabled = true;
                uploadButton.classList.add('disabled');
                selectedFile = null;
                console.log("Formulaire et bouton réinitialisés");
            });
    }

    function createLoadingThumbnail() {
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'thumbnail loading';
        thumbnailDiv.innerHTML = `
            <div class="loading-overlay">
                <div class="lottie-container"></div>
            </div>
            <div class="progressBarContainer">
                <div class="progressBar" style="width: 0%;">0%</div>
            </div>
        `;

        // Initialiser l'animation Lottie
        const lottieContainer = thumbnailDiv.querySelector('.lottie-container');
        lottie.loadAnimation({
            container: lottieContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/loading.json' // Assurez-vous que ce chemin est correct
        });

        return thumbnailDiv;
    }

    // Ajoutez ici les autres fonctions et gestionnaires d'événements nécessaires
    // comme socket.on('conversionProgress'), socket.on('thumbnailGenerated'), etc.
});
});