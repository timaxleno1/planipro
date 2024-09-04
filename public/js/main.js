document.addEventListener('DOMContentLoaded', function () {
    const socket = io();
    let socketId = null;
    let selectedFile = null;

    const fileInput = document.getElementById('pdfFile');
    const uploadButton = document.getElementById('uploadButton');
    const thumbnailsDiv = document.getElementById('thumbnails');
    const deleteSelectedButton = document.getElementById('delete-selected');

    console.log("�l�ments initiaux :", { fileInput, uploadButton, thumbnailsDiv, deleteSelectedButton });

    socket.on('connect', () => {
        console.log('Connect� au serveur Socket.IO');
        socketId = socket.id;
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            const contentId = this.id + '-content';
            document.getElementById(contentId).classList.add('active');
        });
    });

    deleteSelectedButton.addEventListener('click', handleDeleteSelected);

    fileInput.addEventListener('change', function (event) {
        selectedFile = event.target.files[0];
        if (selectedFile) {
            console.log("Fichier s�lectionn�:", selectedFile.name);
            uploadButton.disabled = false;
            displayPdfThumbnails(selectedFile);
        } else {
            console.log("Aucun fichier s�lectionn�");
            uploadButton.disabled = true;
        }
    });

    uploadButton.addEventListener('click', function (event) {
        event.preventDefault();
        console.log("Clic sur le bouton d'upload");

        if (selectedFile) {
            console.log("Fichier � uploader :", selectedFile.name);
            handleFileUpload(selectedFile);
        } else {
            console.log("Aucun fichier s�lectionn� pour l'upload");
            alert("Veuillez s�lectionner un fichier PDF avant de cliquer sur Uploader.");
        }
    });

    function displayPdfThumbnails(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const typedarray = new Uint8Array(e.target.result);

            pdfjsLib.getDocument(typedarray).promise.then(function (pdf) {
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    pdf.getPage(pageNum).then(function (page) {
                        const scale = 1.5;
                        const viewport = page.getViewport({ scale: scale });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        const renderContext = {
                            canvasContext: context,
                            viewport: viewport
                        };
                        page.render(renderContext).promise.then(() => {
                            const thumbnailDiv = document.createElement('div');
                            thumbnailDiv.className = 'thumbnail new-thumbnail';
                            thumbnailDiv.id = `thumbnail-${pageNum}`;
                            thumbnailDiv.innerHTML = `
                                <div class="thumbnail-header">
                                    <input type="checkbox" id="select-${pageNum}" class="thumbnail-select">
                                    <label for="select-${pageNum}">Page ${pageNum}</label>
                                </div>
                                <img src="${canvas.toDataURL()}" alt="Page ${pageNum}">
                                <div class="progress-overlay">
                                    <div class="progress-text">En attente...</div>
                                </div>
                            `;
                            thumbnailsDiv.appendChild(thumbnailDiv);
                        });
                    });
                }
            });
        };
        reader.readAsArrayBuffer(file);
    }

    function handleFileUpload(file) {
        console.log("D�but de l'upload du fichier :", file.name);

        const formData = new FormData();
        formData.append('pdfFile', file);
        formData.append('socketId', socketId);

        document.getElementById('overall-progress').style.display = 'block';
        document.getElementById('overall-progress').querySelector('.progress').style.width = '0%';

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                console.log("R�ponse du serveur apr�s upload :", data);
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
                console.log("R�ponse du serveur apr�s demande de traitement :", data);
                if (data.success) {
                    console.log('Traitement du fichier d�marr�');
                } else {
                    throw new Error('Erreur lors du d�marrage du traitement du fichier.');
                }
            })
            .catch(error => {
                console.error('Erreur :', error);
                alert(error.message);
            })
            .finally(() => {
                fileInput.value = '';
                uploadButton.disabled = true;
                selectedFile = null;
                document.getElementById('overall-progress').style.display = 'none';
                console.log("Formulaire et bouton r�initialis�s");

            });
    }

    socket.on('conversionProgress', (data) => {
        console.log("Progression de la conversion re�ue:", data);
        const thumbnailDiv = document.querySelector(`#thumbnail-${data.page}.new-thumbnail`);
        if (thumbnailDiv) {
            const progressOverlay = thumbnailDiv.querySelector('.progress-overlay');
            const progressText = thumbnailDiv.querySelector('.progress-text');
            if (progressOverlay && progressText) {
                progressText.textContent = `${Math.round(data.percentComplete)}%`;
            }
            if (data.previewImage) {
                const img = thumbnailDiv.querySelector('img');
                if (img) {
                    img.src = data.previewImage;
                }
            }
        }
    });

    socket.on('thumbnailGenerated', (data) => {
        console.log("Vignette g�n�r�e re�ue:", data);
        const thumbnailDiv = document.querySelector(`#thumbnail-${data.page}.new-thumbnail`);
        if (thumbnailDiv) {
            const img = thumbnailDiv.querySelector('img');
            if (img) {
                img.src = data.thumbnail;
            }
            const progressOverlay = thumbnailDiv.querySelector('.progress-overlay');
            if (progressOverlay) {
                progressOverlay.style.display = 'none';
            }
            thumbnailDiv.classList.remove('new-thumbnail');
        }
    });

    socket.on('overallProgress', (data) => {
        console.log("Progression globale re�ue:", data);
        const overallProgressDiv = document.getElementById('overall-progress');
        const progressBar = overallProgressDiv.querySelector('.progress');
        overallProgressDiv.style.display = 'block';
        progressBar.style.width = `${data.percentComplete}%`;
        progressBar.textContent = `${Math.round(data.percentComplete)}%`;
    });

    function createThumbnailElement(data) {
        console.log("Cr�ation de vignette avec les donn�es:", data); // Log pour v�rifier les donn�es re�ues
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.id = `thumbnail-${data.pdfFileName}-${data.page}`;
        thumbnailDiv.className = 'thumbnail';
        thumbnailDiv.innerHTML = `
        <div class="thumbnail-header">
            <input type="checkbox" id="select-${data.pdfFileName}-${data.page}" class="thumbnail-select">
            <label for="select-${data.pdfFileName}-${data.page}">Page ${data.page}</label>
        </div>
        <img src="${data.thumbnail}" alt="Page ${data.page} of ${data.pdfFileName}">
    `;

        thumbnailDiv.addEventListener('click', (event) => {
            if (event.target.type !== 'checkbox') {
                console.log("Vignette cliqu�e pour la page:", data.page, "du fichier:", data.pdfFileName);
                document.getElementById('tab-takeoff-content').innerHTML = `
                    <div id="measurement-tools">
                        <label for="scale">�chelle (m�tres par pixel):</label>
                        <input type="number" id="scale" step="0.01" value="0.01">
                        <button id="measure-line">Mesurer une ligne</button>
                        <button id="measure-perimeter">Mesurer un p�rim�tre</button>
                        <button id="measure-area">Mesurer une surface</button>
                    </div>
                    <canvas id="canvas"></canvas>
                `;
                const canvas = document.getElementById('canvas');
                const context = canvas.getContext('2d');
                const image = new Image();
                image.src = data.highRes;
                image.onload = () => {
                    canvas.width = image.width;
                    canvas.height = image.height;
                    context.drawImage(image, 0, 0);
                };
                setupCanvasInteraction(canvas, context, image);
                document.getElementById('tab-plan-content').classList.remove('active');
                document.getElementById('tab-takeoff-content').classList.add('active');
                document.getElementById('tab-plan').classList.remove('active');
                document.getElementById('tab-takeoff').classList.add('active');
            }
        });

        return thumbnailDiv;
    }

    function loadExistingThumbnails() {
        console.log("Chargement des vignettes existantes...");
        fetch('/thumbnails')
            .then(response => response.json())
            .then(data => {
                console.log("Donn�es des vignettes re�ues:", data);
                data.thumbnails.sort((a, b) => naturalCompare(a.thumbnail, b.thumbnail));
                data.thumbnails.forEach(thumbnail => {
                    const thumbnailDiv = createThumbnailElement(thumbnail);
                    thumbnailsDiv.appendChild(thumbnailDiv);
                });
                console.log("Vignettes existantes charg�es et affich�es");
            })
            .catch(error => {
                console.error('Erreur lors de la r�cup�ration des vignettes existantes:', error);
            });
    }

    function naturalCompare(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    function setupCanvasInteraction(canvas, context, image) {
        console.log("Configuration de l'interaction avec le canvas");
        // Impl�mentez ici la logique d'interaction avec le canvas
    }

    function handleDeleteSelected() {
        const checkedBoxes = document.querySelectorAll('.thumbnail-select:checked');

        if (checkedBoxes.length === 0) {
            alert('Veuillez s�lectionner au moins une vignette � supprimer.');
            return;
        }

        if (confirm(`�tes-vous s�r de vouloir supprimer ${checkedBoxes.length} vignette(s) ?`)) {
            checkedBoxes.forEach(checkbox => {
                const thumbnailDiv = checkbox.closest('.thumbnail');
                const thumbnailId = thumbnailDiv.id;
                console.log("ID de la vignette � supprimer:", thumbnailId); // Log pour v�rification
                const [, pdfFileName, pageNumber] = thumbnailId.split('-');
                console.log("Donn�es extraites:", { pdfFileName, pageNumber }); // Log pour v�rification

                console.log(`Tentative de suppression - PDF: ${pdfFileName}, Page: ${pageNumber}`);

                if (!pdfFileName || !pageNumber) {
                    console.error('Impossible d\'extraire les informations de la vignette:', thumbnailId);
                    return;
                }

                fetch('/delete-thumbnail', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ page: pageNumber, pdfFileName: pdfFileName })
                })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            console.log(`Vignette de la page ${pageNumber} du fichier ${pdfFileName} supprim�e avec succ�s.`);
                            thumbnailDiv.remove();
                        } else {
                            console.error(`Erreur lors de la suppression de la vignette de la page ${pageNumber} du fichier ${pdfFileName}:`, data.error);
                            alert(`Erreur lors de la suppression de la vignette de la page ${pageNumber}. Veuillez r�essayer.`);
                        }
                    })
                    .catch(error => {
                        console.error('Erreur:', error);
                        alert(`Une erreur est survenue lors de la suppression. Veuillez r�essayer.`);
                    });
            });
        }
    }

    loadExistingThumbnails();
});