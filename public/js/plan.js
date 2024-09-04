document.addEventListener('DOMContentLoaded', function () {
    const socket = io();
    let socketId = null;
    let selectedFile = null;

    const fileInput = document.getElementById('pdfFile');
    const uploadButton = document.getElementById('uploadButton');

    console.log("�l�ments initiaux :", {
        fileInput: fileInput,
        uploadButton: uploadButton,
        buttonDisabled: uploadButton.disabled
    });

    socket.on('connect', () => {
        console.log('Connect� au serveur Socket.IO');
        socketId = socket.id;
    });

    fileInput.addEventListener('change', function (event) {
        selectedFile = event.target.files[0];
        console.log("Fichier s�lectionn� :", selectedFile);

        if (selectedFile) {
            console.log("Activation du bouton");
            uploadButton.disabled = false;
            uploadButton.classList.remove('disabled');
        } else {
            console.log("D�sactivation du bouton");
            uploadButton.disabled = true;
            uploadButton.classList.add('disabled');
        }

        console.log("�tat du bouton apr�s changement :", {
            buttonDisabled: uploadButton.disabled,
            buttonClassList: uploadButton.classList
        });
    });

    uploadButton.addEventListener('click', function (event) {
        event.preventDefault();
        console.log("Bouton cliqu�");
        if (selectedFile) {
            handleFileUpload(selectedFile);
        } else {
            console.log("Aucun fichier s�lectionn� pour l'upload");
        }
    });

    function handleFileUpload(file) {
        console.log("D�but de l'upload du fichier:", file.name);

        const formData = new FormData();
        formData.append('pdfFile', file);
        formData.append('socketId', socketId);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                console.log("R�ponse du serveur apr�s upload:", data);
                if (data.success) {
                    console.log('Fichier upload� avec succ�s, d�marrage du traitement');
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
                console.log("R�ponse du serveur apr�s demande de traitement:", data);
                if (data.success) {
                    console.log('Traitement du fichier d�marr�');
                } else {
                    throw new Error('Erreur lors du d�marrage du traitement du fichier.');
                }
            })
            .catch(error => {
                console.error('Erreur:', error);
                alert(error.message);
            })
            .finally(() => {
                // R�initialiser le formulaire et le bouton
                fileInput.value = '';
                uploadButton.disabled = true;
                uploadButton.classList.add('disabled');
                selectedFile = null;
                console.log("Formulaire et bouton r�initialis�s");
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

    // Ajoutez ici les autres fonctions et gestionnaires d'�v�nements n�cessaires
    // comme socket.on('conversionProgress'), socket.on('thumbnailGenerated'), etc.
});
});