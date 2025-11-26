fetch("http://localhost:3000/api/stalkers?username=harshit_1308")
  .then(res => res.json())
  .then(cards => {
    const cardsContainer = document.querySelector(".cards");
    
    // Clear any existing content
    cardsContainer.innerHTML = '';

    cards.forEach(card => {
      // Extract base64 data from the image string
      // The image is already in format: data:image/png;base64,/9j/4AAQ...
      const base64Image = card.image || '';
      
      // Handle username (some might be undefined)
      const username = card.username || 'Unknown User';
      
      // Create card element
      const cardElement = document.createElement('div');
      cardElement.className = 'card';
      
      // Create profile image div
      const imgDiv = document.createElement('div');
      imgDiv.className = 'profile-img';
      if (base64Image) {
        imgDiv.style.backgroundImage = `url(${base64Image})`;
      } else {
        imgDiv.style.backgroundColor = '#f0f0f0';
        imgDiv.style.display = 'flex';
        imgDiv.style.alignItems = 'center';
        imgDiv.style.justifyContent = 'center';
        imgDiv.textContent = 'No Image';
      }
      
      // Create profile name element
      const nameElement = document.createElement('h2');
      nameElement.className = 'profile-name';
      nameElement.textContent = username;
      
      // Append to card
      cardElement.appendChild(imgDiv);
      cardElement.appendChild(nameElement);
      
      // Append to container
      cardsContainer.appendChild(cardElement);
    });
    
    console.log(`✅ Displayed ${cards.length} cards`);
  })
  .catch(error => {
    console.error('❌ Error fetching cards:', error);
    const cardsContainer = document.querySelector(".cards");
    cardsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #d32f2f;">
        <h2>Error loading cards</h2>
        <p>${error.message}</p>
        <p>Make sure the backend server is running on port 3000</p>
      </div>
    `;
  });

